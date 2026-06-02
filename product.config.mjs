// ─────────────────────────────────────────────────────────────────────────
// Single source of truth for cross-surface product/brand strings.
//
// WHY: the product name, domain, npm name, repo URL, tagline and canonical
// links were copy-pasted across astro.config.mjs, SiteTitle.astro, server.json,
// llms.txt and the READMEs. Editing one and forgetting the others caused drift.
// Import this module instead of hardcoding those values.
//
// WHAT IS *NOT* DUPLICATED HERE (read from the real source so it can't drift):
//   - version  → read from mcp/package.json (the npm source of truth)
//   - counts   → read from mcp/data/playbook-spec.json (generated from MDX)
//
// WHO READS THIS:
//   - astro.config.mjs (site, titles, description, og strings, redirects)
//   - src/components/SiteTitle.astro (product vs umbrella brand)
//   - mcp/build/gen-meta.mjs → regenerates server.json on prebuild
// Prose files (READMEs, llms.txt body) stay hand-written; this is their
// reference if values change.
// ─────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));

function readJson(rel, fallback = {}) {
	try {
		return JSON.parse(readFileSync(here(rel), 'utf8'));
	} catch {
		return fallback;
	}
}

// Version lives in the npm package manifest — the one place that matters for
// publishing. Everything else reads it from here.
const mcpPkg = readJson('./mcp/package.json', { version: '0.0.0' });

// Counts come from the generated spec. On a clean checkout before the first
// `build:spec` the spec may be absent — guard with sane fallbacks.
const spec = readJson('./mcp/data/playbook-spec.json', { categories: [], components: [] });
const ruleCategories = (spec.categories || []).filter((c) => c.slug !== 'components');
const rulePageCount = ruleCategories.reduce((n, c) => n + (c.page_count || 0), 0);
const categoryCount = ruleCategories.length;
const componentCount = (spec.components || []).length;

const DOMAIN = 'docs.osamahassouna.com';
const SITE = `https://${DOMAIN}`;
const BASE_PATH = '/email-playbook/';

export const product = {
	// Brand
	name: 'Email Playbook',
	fullName: 'HTML Email Playbook',
	umbrella: 'Osama Hassouna',
	tagline:
		'Teaches AI to write HTML email that renders in Outlook, Gmail, and Apple Mail.',
	description:
		'An MCP server and CLI that teach AI clients to write HTML email that renders in Outlook and Gmail — plus a free playground that turns a screenshot into production-ready email HTML.',

	// Versioned bits (sourced, not duplicated)
	version: mcpPkg.version,
	counts: { rulePages: rulePageCount, categories: categoryCount, components: componentCount },

	// Identity
	npmName: 'email-playbook-mcp',
	mcpName: mcpPkg.mcpName || 'io.github.OsamaHassouna/email-playbook-mcp',
	// MCP spec revision the server implements. Single source: the hosted
	// endpoint (src/pages/api/mcp.ts) reads this; the README badge mirrors it.
	protocolVersion: '2024-11-05',
	repoUrl: 'https://github.com/OsamaHassouna/docs-hub',
	repoSubfolder: 'mcp',
	author: 'Osama Hassouna <eng.osama2021@gmail.com>',
	license: 'MIT',

	// URLs
	domain: DOMAIN,
	site: SITE,
	basePath: BASE_PATH,
	links: {
		landing: BASE_PATH,
		docs: `${BASE_PATH}getting-started/`,
		playground: `${BASE_PATH}playground/`,
		mcp: `${BASE_PATH}mcp/`,
		apiEndpoint: `${SITE}/api/mcp`,
		npm: 'https://www.npmjs.com/package/email-playbook-mcp',
	},

	// Social card
	og: {
		image: `${SITE}/og-default.png`,
		alt: 'HTML Email Playbook — MCP server + CLI that teaches AI to write email that renders in Outlook and Gmail',
	},
};

export default product;
