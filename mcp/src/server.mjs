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

import { getTools, runTool } from './tools.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));

const server = new Server(
  { name: 'email-playbook', version: PKG.version },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: getTools(),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    const result = await runTool(name, args ?? {});
    return {
      content: [
        { type: 'text', text: JSON.stringify(result, null, 2) },
      ],
    };
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
