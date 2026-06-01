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

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = join(__dirname, '..', 'src', 'server.mjs');
const CLI_PATH = join(__dirname, '..', 'src', 'cli.mjs');

const EXPECTED_TOOLS = ['list_categories', 'get_playbook_rules', 'list_components', 'get_component'];

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
  await check('tools/list returns the expected four tools', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    assert.deepEqual(names, [...EXPECTED_TOOLS].sort());
    for (const t of tools) assert.ok(t.description && t.description.length > 10, `${t.name} has a description`);
  });

  await check('list_categories returns 4 categories with page counts', async () => {
    const res = await client.callTool({ name: 'list_categories', arguments: {} });
    const cats = JSON.parse(res.content[0].text);
    assert.equal(cats.length, 4);
    for (const c of cats) {
      assert.ok(c.slug, 'category has slug');
      assert.ok(Number.isInteger(c.page_count) && c.page_count > 0, `${c.slug} has page_count`);
    }
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

  console.log(`\n${passed} checks passed${process.exitCode ? ' (with failures above)' : ''}`);
  if (!process.exitCode) console.log('smoke ok');
}

main().catch((err) => {
  console.error('smoke test crashed:', err);
  process.exit(1);
});
