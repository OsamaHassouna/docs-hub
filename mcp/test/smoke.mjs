#!/usr/bin/env node
/**
 * Smoke test for email-playbook-mcp.
 *
 * Asserts the MCP server starts, exposes the expected tools, each tool
 * round-trips against the generated spec, the error path is signalled
 * correctly, and the CLI returns sane exit codes.
 *
 * Run: `node mcp/test/smoke.mjs` from the docs-hub root. Exits 0 on pass,
 * 1 on any failed assertion (so CI fails loudly).
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { loadSpec, runTool, setSpec } from '../src/tools.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = join(__dirname, '..', 'src', 'server.mjs');
const CLI_PATH = join(__dirname, '..', 'src', 'cli.mjs');

// Same file the server and CLI read; taken before any check swaps in a fixture.
const RULE_COUNT = loadSpec().rules.length;

const EXPECTED_TOOLS = ['list_categories', 'get_playbook_rules', 'get_rule', 'list_components', 'get_component'];

let passed = 0;
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log(`  ok  ${name}`); })
    .catch((err) => { console.error(`FAIL  ${name}\n      ${err.message}`); process.exitCode = 1; });
}

function runCli(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function main() {
  console.log('email-playbook-mcp smoke test\n');

  const transport = new StdioClientTransport({ command: process.execPath, args: [SERVER_PATH] });
  const client = new Client({ name: 'smoke-test', version: '0.0.1' }, { capabilities: {} });
  await client.connect(transport);

  // --- MCP server ---
  await check('tools/list returns the expected five tools', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    assert.deepEqual(names, [...EXPECTED_TOOLS].sort());
    for (const t of tools) {
      assert.ok(t.description && t.description.length > 10, `${t.name} has a description`);
      assert.equal(t.annotations?.readOnlyHint, true, `${t.name} is annotated read-only`);
    }
  });

  await check('initialize sends instructions with the checklist-first order', async () => {
    const instructions = client.getInstructions();
    assert.ok(instructions?.includes('checklist') && instructions.includes('get_rule'), instructions);
  });

  await check('get_playbook_rules checklist with no category returns every page', async () => {
    const res = await client.callTool({ name: 'get_playbook_rules', arguments: { format: 'checklist' } });
    const pages = JSON.parse(res.content[0].text);
    assert.equal(pages.length, RULE_COUNT);
    assert.ok(Buffer.byteLength(res.content[0].text) < 25_000, 'all checklists in one small call');
    // Some clients send null for every optional argument they leave unset.
    const nulls = await client.callTool({ name: 'get_playbook_rules', arguments: { format: 'checklist', category: null } });
    assert.equal(nulls.content[0].text, res.content[0].text, 'category null = left out');
  });

  await check('get_playbook_rules full with no category sets isError', async () => {
    const res = await client.callTool({ name: 'get_playbook_rules', arguments: {} });
    assert.equal(res.isError, true);
    assert.ok(res.content[0].text.includes("'category'"), 'message names the argument');
  });

  await check('get_playbook_rules: "" counts as left out for category and format', async () => {
    const all = await client.callTool({ name: 'get_playbook_rules', arguments: { format: 'checklist' } });
    const blank = await client.callTool({ name: 'get_playbook_rules', arguments: { category: '', format: 'checklist' } });
    assert.equal(blank.content[0].text, all.content[0].text);
    const full = await client.callTool({ name: 'get_playbook_rules', arguments: { category: 'structure' } });
    const blankFormat = await client.callTool({ name: 'get_playbook_rules', arguments: { category: 'structure', format: '' } });
    assert.equal(blankFormat.content[0].text, full.content[0].text);
  });

  await check('get_playbook_rules: category "components" points to list_components', async () => {
    const res = await client.callTool({ name: 'get_playbook_rules', arguments: { category: 'Components', format: 'checklist' } });
    assert.equal(res.isError, true);
    assert.ok(res.content[0].text.includes('list_components'), res.content[0].text);
  });

  await check('list_categories returns 4 categories with page counts', async () => {
    const res = await client.callTool({ name: 'list_categories', arguments: {} });
    const cats = JSON.parse(res.content[0].text);
    assert.equal(cats.length, 4);
    for (const c of cats) {
      assert.ok(c.slug, 'category has slug');
      assert.ok(Number.isInteger(c.page_count) && c.page_count > 0, `${c.slug} has page_count`);
      assert.equal(c.pages?.length, c.page_count, `${c.slug} lists its pages`);
      for (const p of c.pages) assert.ok(p.slug.startsWith(`${c.slug}/`) && p.title, `${p.slug} has slug + title`);
    }
  });

  await check('get_playbook_rules checklist: every page has rules, all four categories under 25 KB', async () => {
    let total = 0;
    for (const category of ['structure', 'compatibility', 'production', 'ai-generation']) {
      const res = await client.callTool({ name: 'get_playbook_rules', arguments: { category, format: 'checklist' } });
      total += Buffer.byteLength(res.content[0].text);
      for (const r of JSON.parse(res.content[0].text)) {
        assert.ok(Array.isArray(r.checklist) && r.checklist.length > 0, `${r.slug} has a checklist`);
        assert.equal(r.body_md, undefined, `${r.slug} checklist has no body`);
      }
    }
    assert.ok(total < 25_000, `checklists total ${total} bytes`);
  });

  await check('get_playbook_rules: an unknown format sets isError', async () => {
    const res = await client.callTool({ name: 'get_playbook_rules', arguments: { category: 'structure', format: 'short' } });
    assert.equal(res.isError, true);
    assert.ok(res.content[0].text.includes("'format'"), 'message names the argument');
  });

  await check('get_rule: full slug and bare page name return the same single page', async () => {
    const full = await client.callTool({ name: 'get_rule', arguments: { slug: 'compatibility/responsive' } });
    const bare = await client.callTool({ name: 'get_rule', arguments: { slug: 'responsive' } });
    const page = JSON.parse(full.content[0].text);
    assert.equal(page.slug, 'compatibility/responsive');
    assert.ok(page.body_md.includes('```html'), 'body carries the code');
    assert.equal(page.examples, undefined, 'no duplicate examples by default');
    assert.equal(full.content[0].text, bare.content[0].text);
    const all = await client.callTool({ name: 'get_playbook_rules', arguments: { category: 'compatibility' } });
    assert.ok(full.content[0].text.length < all.content[0].text.length / 2, 'well under the whole category');
  });

  await check('get_rule: any case, slashes, and the docs links in the bodies find the page', async () => {
    for (const slug of ['RESPONSIVE', '/Compatibility/Responsive/', '/email-playbook/compatibility/responsive/#columns',
      'https://docs.osamahassouna.com/email-playbook/compatibility/responsive/']) {
      const res = await client.callTool({ name: 'get_rule', arguments: { slug } });
      assert.equal(JSON.parse(res.content[0].text).slug, 'compatibility/responsive', slug);
    }
  });

  await check('get_rule: include_examples adds the examples array', async () => {
    const res = await client.callTool({ name: 'get_rule', arguments: { slug: 'structure/head', include_examples: true } });
    assert.ok(JSON.parse(res.content[0].text).examples.length > 0);
    const bad = await client.callTool({ name: 'get_rule', arguments: { slug: 'structure/head', include_examples: 'yes' } });
    assert.equal(bad.isError, true, 'a non-boolean include_examples is an error');
  });

  await check('get_rule: a bare name on two pages is an error naming both', async () => {
    // No two pages share a name today, so this runs in-process on a fixture spec.
    const page = (slug) => ({ slug, category: slug.split('/')[0], title: slug, description: '', checklist: ['x'], body_md: '', examples: [] });
    const real = loadSpec();
    setSpec({ categories: [], components: [], rules: [page('structure/head'), page('production/head')] });
    try {
      await assert.rejects(runTool('get_rule', { slug: 'head' }), /structure\/head, production\/head/);
      assert.equal((await runTool('get_rule', { slug: 'Production/Head' })).slug, 'production/head');
    } finally {
      setSpec(real);
    }
  });

  await check('get_rule: unknown slug sets isError and lists the slugs', async () => {
    const res = await client.callTool({ name: 'get_rule', arguments: { slug: 'nope' } });
    assert.equal(res.isError, true);
    assert.ok(res.content[0].text.includes('compatibility/responsive'), 'message lists slugs');
  });

  await check('get_rule: a component link or a category name points to the right tool', async () => {
    const res = await client.callTool({ name: 'get_rule', arguments: { slug: '/email-playbook/components/buttons/' } });
    assert.equal(res.isError, true);
    assert.ok(res.content[0].text.includes("get_component with name 'buttons'"), 'message names get_component');
    const cat = await client.callTool({ name: 'get_rule', arguments: { slug: 'structure' } });
    assert.equal(cat.isError, true);
    assert.ok(cat.content[0].text.includes("get_playbook_rules with category 'structure'"), 'message names get_playbook_rules');
  });

  await check('list_components returns 6 components with metadata', async () => {
    const res = await client.callTool({ name: 'list_components', arguments: {} });
    const comps = JSON.parse(res.content[0].text);
    assert.equal(comps.length, 6);
    for (const c of comps) {
      assert.ok(c.name, 'component has name');
      assert.ok(c.subcategory, `${c.name} has subcategory`);
      assert.equal(typeof c.requires_vml, 'boolean', `${c.name}.requires_vml is boolean`);
      assert.equal(typeof c.responsive, 'boolean', `${c.name}.responsive is boolean`);
    }
  });

  await check('get_component buttons round-trips with html + slots', async () => {
    const res = await client.callTool({ name: 'get_component', arguments: { name: 'buttons' } });
    const btn = JSON.parse(res.content[0].text);
    assert.equal(btn.name, 'buttons');
    assert.ok(btn.html.includes('<td>'), 'html present');
    assert.ok(Array.isArray(btn.slots) && btn.slots.length > 0, 'slots present');
  });

  await check('get_playbook_rules structure returns rules with examples', async () => {
    const res = await client.callTool({ name: 'get_playbook_rules', arguments: { category: 'structure' } });
    const rules = JSON.parse(res.content[0].text);
    assert.ok(rules.length >= 1, 'at least one rule');
    for (const r of rules) assert.ok(Array.isArray(r.examples), `${r.slug} has examples array`);
  });

  await check('error path: unknown component sets isError', async () => {
    const res = await client.callTool({ name: 'get_component', arguments: { name: 'nope' } });
    assert.equal(res.isError, true);
    assert.ok(res.content[0].text.toLowerCase().includes('unknown'), 'message mentions unknown');
  });

  await client.close();

  // --- CLI exit codes ---
  await check('CLI: list-categories exits 0 with JSON', async () => {
    const { code, stdout } = await runCli(['list-categories']);
    assert.equal(code, 0);
    const parsed = JSON.parse(stdout);
    assert.ok(Array.isArray(parsed) && parsed.length === 4);
  });

  await check('CLI: --help exits 0', async () => {
    const { code, stdout } = await runCli(['--help']);
    assert.equal(code, 0);
    assert.ok(stdout.includes('Usage:'));
  });

  await check('CLI: unknown command exits 2', async () => {
    const { code } = await runCli(['bogus-command']);
    assert.equal(code, 2);
  });

  await check('CLI: get-component with bad name exits 1', async () => {
    const { code } = await runCli(['get-component', 'nope']);
    assert.equal(code, 1);
  });

  // Every spelling: the CLI names and the MCP tool names are one command.
  const spellings = [
    [['list-categories'], ['list_categories']],
    [['get-rules', 'production'], ['get_playbook_rules', 'production'], ['get-playbook-rules', 'production']],
    [['get-rule', 'preheader'], ['get_rule', 'production/preheader']],
    [['list-components'], ['list_components']],
    [['get-component', 'buttons'], ['get_component', 'buttons']],
  ];
  for (const group of spellings) {
    await check(`CLI: ${group.map((g) => g[0]).join(' = ')}`, async () => {
      const outputs = [];
      for (const args of group) {
        const { code, stdout, stderr } = await runCli(args);
        assert.equal(code, 0, `${args.join(' ')} exits 0 (${stderr.trim()})`);
        outputs.push(stdout);
      }
      for (const out of outputs) assert.equal(out, outputs[0]);
    });
  }

  await check('CLI: get-rules --checklist prints checklists only', async () => {
    const { code, stdout } = await runCli(['get-rules', 'structure', '--checklist']);
    assert.equal(code, 0);
    const rules = JSON.parse(stdout);
    assert.ok(rules.every((r) => r.checklist.length > 0 && r.body_md === undefined));
  });

  await check('CLI: an unknown flag exits 2', async () => {
    for (const flag of ['--nope', '-x']) {
      const { code, stderr } = await runCli(['get-rule', 'preheader', flag]);
      assert.equal(code, 2, flag);
      assert.ok(stderr.includes(`doesn't take '${flag}'`), stderr);
    }
  });

  await check('CLI: get-rules --checklist with no category prints every page', async () => {
    const { code, stdout } = await runCli(['get-rules', '--checklist']);
    assert.equal(code, 0);
    assert.equal(JSON.parse(stdout).length, RULE_COUNT);
  });

  await check('CLI: --md prints markdown for get-rule and get-rules', async () => {
    const one = await runCli(['get-rule', 'preheader', '--md']);
    assert.equal(one.code, 0);
    assert.ok(one.stdout.startsWith('# ') && one.stdout.includes('**Checklist**') && one.stdout.includes('```html'), 'page + body');
    const all = await runCli(['get-rules', '--checklist', '--markdown']);
    assert.equal(all.code, 0);
    assert.equal((all.stdout.match(/^# /gm) ?? []).length, RULE_COUNT);
  });

  await check('CLI: help and version work as commands', async () => {
    const help = await runCli(['help']);
    assert.equal(help.code, 0);
    assert.ok(help.stdout.includes('Usage:'));
    const version = await runCli(['version']);
    assert.equal(version.code, 0);
    assert.match(version.stdout.trim(), /^\d+\.\d+\.\d+$/);
  });

  await check('CLI: <command> --help and -h print the help', async () => {
    for (const flag of ['--help', '-h']) {
      const { code, stdout } = await runCli(['get-rule', flag]);
      assert.equal(code, 0, flag);
      assert.ok(stdout.includes('Usage:'), flag);
    }
  });

  console.log(`\n${passed} checks passed${process.exitCode ? ' (with failures above)' : ''}`);
  if (!process.exitCode) console.log('smoke ok');
}

main().catch((err) => {
  console.error('smoke test crashed:', err);
  process.exit(1);
});
