#!/usr/bin/env node
// Regenerate server.json (the official MCP Registry manifest) from the single
// source: product.config.mjs + mcp/package.json. Run on prebuild so a version
// bump or a string change in the config propagates to server.json automatically
// instead of being hand-edited in two places.
//
// Run: `node mcp/build/gen-meta.mjs` (or via `npm run build:spec` / prebuild).

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { product } from '../../product.config.mjs';

const out = fileURLToPath(new URL('../../server.json', import.meta.url));

const desc =
	`Teaches AI to write HTML email that renders in Outlook, Gmail, and Apple Mail. ` +
	`${product.counts.rulePages} rules, ${product.counts.components} comps.`;

const serverManifest = {
	$schema: 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json',
	name: product.mcpName,
	title: product.fullName,
	description: desc,
	version: product.version,
	repository: {
		url: product.repoUrl,
		source: 'github',
		subfolder: product.repoSubfolder,
	},
	websiteUrl: `${product.site}${product.basePath}`,
	packages: [
		{
			registryType: 'npm',
			registryBaseUrl: 'https://registry.npmjs.org',
			identifier: product.npmName,
			version: product.version,
			transport: { type: 'stdio' },
			runtimeHint: 'npx',
		},
	],
	remotes: [
		{ type: 'streamable-http', url: product.links.apiEndpoint },
	],
};

writeFileSync(out, JSON.stringify(serverManifest, null, 2) + '\n');
console.log(`server.json regenerated → ${product.mcpName}@${product.version} (${product.counts.rulePages} rules, ${product.counts.components} comps)`);
