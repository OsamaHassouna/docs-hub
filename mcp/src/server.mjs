#!/usr/bin/env node
/**
 * Email Playbook MCP server — stdio transport.
 *
 * Entry point for the published npm package. Users add this to their MCP
 * client config (Claude Desktop, Cursor, etc.) and the model gains the
 * playbook tools.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { getTools, loadSpec, runTool, SERVER_INSTRUCTIONS, staleNotice } from './tools.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));

// Shown in the instructions and once, on the first tool result, because
// many clients never show server instructions to the model.
const STALE_NOTICE = staleNotice(loadSpec(), { version: PKG.version });
let staleNoticePending = Boolean(STALE_NOTICE);

const server = new Server(
  { name: 'email-playbook', version: PKG.version },
  { capabilities: { tools: {} }, instructions: STALE_NOTICE ? `${SERVER_INSTRUCTIONS}\n\n${STALE_NOTICE}` : SERVER_INSTRUCTIONS },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: getTools(),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    const result = await runTool(name, args ?? {});
    const content = [{ type: 'text', text: JSON.stringify(result, null, 2) }];
    if (staleNoticePending) {
      staleNoticePending = false;
      content.push({ type: 'text', text: STALE_NOTICE });
    }
    return { content };
  } catch (err) {
    return {
      content: [
        { type: 'text', text: `Error: ${err.message ?? String(err)}` },
      ],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
