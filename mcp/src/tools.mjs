/**
 * Email Playbook MCP — tool definitions and implementations.
 *
 * Pure data + functions. Shared between the stdio MCP server (server.mjs)
 * and the hosted /api/mcp HTTP endpoint in the docs-hub Astro app.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPEC_PATH = join(__dirname, '..', 'data', 'playbook-spec.json');

let cachedSpec = null;

// Prime the spec cache from a pre-loaded object. Used by the hosted Astro
// endpoint, where Vercel's bundler inlines the JSON import but won't ship
// the source `data/` folder next to the bundled chunk for fs reads.
export function setSpec(spec) {
  cachedSpec = spec;
}

export function loadSpec() {
  if (cachedSpec) return cachedSpec;
  cachedSpec = JSON.parse(readFileSync(SPEC_PATH, 'utf8'));
  return cachedSpec;
}

// Re-export so CLI/server can read the spec for dynamic help and listings.
// (loadSpec is already exported above.)

/**
 * MCP tool definitions. Schema follows JSON Schema draft-07.
 */
export function getTools() {
  const spec = loadSpec();
  const componentNames = spec.components.map(c => c.name);
  const ruleCategories = Array.from(new Set(spec.rules.map(r => r.category)));

  return [
    {
      name: 'list_categories',
      description:
        'List all rule categories in the Email Playbook with a one-line description and page count. ' +
        'Categories are: structure (head/body container/header/body/footer), compatibility (Outlook MSO, RTL, responsive), ' +
        'production (Gmail clipping, dark mode, preheader, bulletproof buttons), ai-generation (constraints for AI emitters). ' +
        'For reusable components, use list_components instead — they live in a separate dimension and are not returned by get_playbook_rules.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: 'get_playbook_rules',
      description:
        'Return the full rule pages for a given category. Each rule includes the title, description, ' +
        'markdown body explaining the rule, and any HTML/CSS code examples from the playbook. ' +
        'Use this to teach a model the exact patterns for a specific concern (e.g., responsive layout).',
      inputSchema: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            enum: ruleCategories,
            description: 'Which rule category to fetch.',
          },
        },
        required: ['category'],
        additionalProperties: false,
      },
    },
    {
      name: 'list_components',
      description:
        'List all reusable email components in the playbook with their metadata: ' +
        'name, subcategory (layout/media/interactive/text), description, whether they require Outlook VML, ' +
        'and whether they are responsive. Use this first to discover what components exist before calling get_component.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: 'get_component',
      description:
        'Return the full record for a single component: title, description, narrative body, the primary HTML pattern, ' +
        'list of slots (placeholders the model should fill), VML/responsive flags, and all code examples. ' +
        'Use after list_components to fetch the actual HTML pattern to paste into an email.',
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            enum: componentNames,
            description: 'Component name. Get the list from list_components first.',
          },
        },
        required: ['name'],
        additionalProperties: false,
      },
    },
  ];
}

// Cap user-supplied strings echoed in error messages so a 10kB
// adversarial input doesn't bloat logs or response bodies.
function trunc(s, n = 80) {
  const str = String(s);
  return str.length <= n ? str : `${str.slice(0, n)}…`;
}

/**
 * Execute a tool. Returns a JSON-serializable result.
 * Throws on unknown tool or invalid arguments.
 */
export async function runTool(name, args = {}) {
  const spec = loadSpec();

  switch (name) {
    case 'list_categories':
      return spec.categories;

    case 'get_playbook_rules': {
      const category = args?.category;
      if (typeof category !== 'string' || category.length === 0) {
        throw new Error("Argument 'category' must be a non-empty string.");
      }
      const rules = spec.rules.filter(r => r.category === category);
      if (rules.length === 0) {
        throw new Error(
          `No rules found for category '${trunc(category)}'. Available: ${Array.from(new Set(spec.rules.map(r => r.category))).join(', ')}.`,
        );
      }
      return rules;
    }

    case 'list_components':
      return spec.components.map(c => ({
        name: c.name,
        subcategory: c.subcategory,
        title: c.title,
        description: c.description,
        requires_vml: c.requires_vml,
        responsive: c.responsive,
      }));

    case 'get_component': {
      const compName = args?.name;
      if (typeof compName !== 'string' || compName.length === 0) {
        throw new Error("Argument 'name' must be a non-empty string.");
      }
      const comp = spec.components.find(c => c.name === compName);
      if (!comp) {
        throw new Error(
          `Unknown component '${trunc(compName)}'. Available: ${spec.components.map(c => c.name).join(', ')}.`,
        );
      }
      return comp;
    }

    default:
      throw new Error(`Unknown tool '${trunc(name)}'. Call tools/list to discover.`);
  }
}
