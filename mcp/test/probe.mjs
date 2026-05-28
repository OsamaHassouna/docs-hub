#!/usr/bin/env node
/**
 * Local MCP probe.
 *
 * Spawns the email-playbook-mcp server via stdio, connects as an MCP
 * client, lists tools, calls each one, and prints a short summary.
 *
 * Run: `node mcp/test/probe.mjs` from the docs-hub root.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = join(__dirname, '..', 'src', 'server.mjs');

function preview(text, n = 120) {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  return trimmed.length > n ? trimmed.slice(0, n) + '…' : trimmed;
}

async function main() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_PATH],
  });

  const client = new Client(
    { name: 'email-playbook-probe', version: '0.0.1' },
    { capabilities: {} },
  );

  await client.connect(transport);

  console.log('=== server info ===');
  console.log(client.getServerVersion());

  console.log('\n=== tools/list ===');
  const list = await client.listTools();
  for (const tool of list.tools) {
    console.log(` - ${tool.name}`);
    console.log(`     ${preview(tool.description, 100)}`);
  }

  console.log('\n=== tools/call: list_categories ===');
  const cats = await client.callTool({ name: 'list_categories', arguments: {} });
  const catsParsed = JSON.parse(cats.content[0].text);
  console.log(`returned ${catsParsed.length} categories`);
  for (const c of catsParsed) console.log(`   - ${c.slug} (${c.page_count} pages)`);

  console.log('\n=== tools/call: list_components ===');
  const comps = await client.callTool({ name: 'list_components', arguments: {} });
  const compsParsed = JSON.parse(comps.content[0].text);
  console.log(`returned ${compsParsed.length} components`);
  for (const c of compsParsed) {
    console.log(`   - ${c.name} [${c.subcategory}]  vml=${c.requires_vml}  resp=${c.responsive}`);
  }

  console.log('\n=== tools/call: get_component name=buttons ===');
  const btn = await client.callTool({
    name: 'get_component',
    arguments: { name: 'buttons' },
  });
  const btnParsed = JSON.parse(btn.content[0].text);
  console.log(`  slots: ${btnParsed.slots.join(', ')}`);
  console.log(`  html length: ${btnParsed.html.length} chars, first line:`);
  console.log(`     ${preview(btnParsed.html.split('\n')[0], 100)}`);

  console.log('\n=== tools/call: get_playbook_rules category=structure ===');
  const rules = await client.callTool({
    name: 'get_playbook_rules',
    arguments: { category: 'structure' },
  });
  const rulesParsed = JSON.parse(rules.content[0].text);
  console.log(`returned ${rulesParsed.length} rules in structure`);
  for (const r of rulesParsed) console.log(`   - ${r.slug}: ${r.title} (${r.examples.length} examples)`);

  console.log('\n=== error path: get_component name=nonexistent ===');
  const bad = await client.callTool({
    name: 'get_component',
    arguments: { name: 'nonexistent' },
  });
  console.log(`isError: ${bad.isError}`);
  console.log(`text: ${bad.content[0].text}`);

  await client.close();
  console.log('\nprobe ok');
}

main().catch(err => {
  console.error('probe failed:', err);
  process.exit(1);
});
