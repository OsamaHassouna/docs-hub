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

// Sent with initialize (stdio server and hosted endpoint) so clients that
// surface server instructions know the cheap order to read the playbook in.
export const SERVER_INSTRUCTIONS =
  'The Email Playbook: rules and HTML patterns for emails that render in Outlook, Gmail and Apple Mail. ' +
  'Suggested order: (1) get_playbook_rules with format "checklist" and no category, for the rules on every page in one small call; ' +
  '(2) get_rule for the pages you need in full, with their code; (3) list_components and get_component for reusable patterns ' +
  '(buttons, images, spacing...), which the checklists do not cover. Prefer these patterns over general email knowledge.';

// Every tool only reads the bundled spec.
const READ_ONLY = { readOnlyHint: true, idempotentHint: true, openWorldHint: false };

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
        'List all rule categories in the Email Playbook with a one-line description, page count, and the slug and title of each page in it. ' +
        'Categories are: structure (head/body container/header/body/footer), compatibility (Outlook MSO, RTL, responsive), ' +
        'production (Gmail clipping, dark mode, preheader, bulletproof buttons), ai-generation (constraints for AI emitters). ' +
        'Pass a page slug to get_rule to fetch just that page. ' +
        'For reusable components, use list_components instead — they live in a separate dimension and are not returned by get_playbook_rules.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      annotations: READ_ONLY,
    },
    {
      name: 'get_playbook_rules',
      description:
        'Return rule pages. format "checklist": each page as its slug, title, description and a short list of the rules to ' +
        'follow, without the body or code; leave out category to get every page in one call (about 16 KB). ' +
        'format "full" (default, needs a category): each page with title, description, checklist, markdown body and all ' +
        'HTML/CSS code examples. Start with the checklists, then fetch the pages you need with get_rule. ' +
        'Components are not included: use list_components / get_component.',
      inputSchema: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            enum: ruleCategories,
            description: 'Which rule category to fetch. Required for format "full"; optional for "checklist".',
          },
          format: {
            type: 'string',
            enum: ['full', 'checklist'],
            description: 'full (default): whole pages with code. checklist: titles and rules only.',
          },
        },
        additionalProperties: false,
      },
      annotations: READ_ONLY,
    },
    {
      name: 'get_rule',
      description:
        'Return one rule page: slug, category, title, description, checklist, and the markdown body, which includes the page\'s ' +
        'HTML/CSS code. Accepts the full slug (e.g. "compatibility/responsive"), just the page name ("responsive"), ' +
        'or a page link from a body ("/email-playbook/compatibility/responsive/"). ' +
        'Get the slugs from list_categories. Much smaller than fetching the whole category with get_playbook_rules.',
      inputSchema: {
        type: 'object',
        properties: {
          slug: {
            type: 'string',
            description: 'Page slug, e.g. "compatibility/responsive" or "responsive".',
          },
          include_examples: {
            type: 'boolean',
            description: 'Also return the code examples as a separate array (they are already in the body). Default false.',
          },
        },
        required: ['slug'],
        additionalProperties: false,
      },
      annotations: READ_ONLY,
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
      annotations: READ_ONLY,
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
      annotations: READ_ONLY,
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
      return spec.categories.map(c => ({
        ...c,
        pages: spec.rules.filter(r => r.category === c.slug).map(r => ({ slug: r.slug, title: r.title })),
      }));

    case 'get_playbook_rules': {
      // null and "" count as left out: some clients send one of them for every
      // optional argument they don't set.
      const unset = (v) => v == null || v === '';
      const format = unset(args?.format) ? 'full' : args.format;
      if (format !== 'full' && format !== 'checklist') {
        throw new Error(`Argument 'format' must be 'full' or 'checklist', got '${trunc(format)}'.`);
      }
      const category = unset(args?.category) ? undefined : args.category;
      // Checklists for every page fit in one small call; full pages don't.
      const allPages = category === undefined && format === 'checklist';
      if (!allPages && (typeof category !== 'string' || category.length === 0)) {
        throw new Error("Argument 'category' must be a non-empty string (it can be left out only with format 'checklist').");
      }
      const rules = allPages ? spec.rules : spec.rules.filter(r => r.category === category);
      if (rules.length === 0 && String(category).trim().toLowerCase() === 'components') {
        throw new Error("Components aren't rule pages. Call list_components, then get_component with a name.");
      }
      if (rules.length === 0) {
        throw new Error(
          `No rules found for category '${trunc(category)}'. Available: ${Array.from(new Set(spec.rules.map(r => r.category))).join(', ')}.`,
        );
      }
      if (format === 'checklist') {
        return rules.map(({ slug, title, description, checklist }) => ({ slug, title, description, checklist }));
      }
      return rules;
    }

    case 'get_rule': {
      const slug = args?.slug;
      if (typeof slug !== 'string' || slug.length === 0) {
        throw new Error("Argument 'slug' must be a non-empty string.");
      }
      if (args.include_examples != null && typeof args.include_examples !== 'boolean') {
        throw new Error("Argument 'include_examples' must be a boolean.");
      }
      // The page bodies link each other by docs URL path
      // (/email-playbook/structure/header/#background-image), so take those too.
      const wanted = slug.trim().toLowerCase()
        .replace(/[?#].*$/, '')
        .replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/, '')
        .replace(/^\/+|\/+$/g, '')
        .replace(/^email-playbook\//, '');
      // A bare page name is fine when it names exactly one page.
      const exact = spec.rules.find(r => r.slug.toLowerCase() === wanted);
      const byName = exact ? [] : spec.rules.filter(r => r.slug.split('/').pop().toLowerCase() === wanted);
      if (byName.length > 1) {
        throw new Error(`Rule name '${trunc(slug)}' matches more than one page: ${byName.map(r => r.slug).join(', ')}. Pass the full slug.`);
      }
      const rule = exact ?? byName[0];
      if (!rule) {
        // Bodies link component pages too (/email-playbook/components/buttons/);
        // those live behind get_component, so say so instead of a bare "unknown".
        const component = spec.components.find(c => c.slug.toLowerCase() === wanted || c.name.toLowerCase() === wanted);
        if (component) {
          throw new Error(`'${trunc(slug)}' is a component, not a rule page. Call get_component with name '${component.name}' (CLI: email-playbook get-component ${component.name}).`);
        }
        if ((spec.categories ?? []).some(c => c.slug === wanted)) {
          throw new Error(`'${trunc(slug)}' is a category, not a rule page. Call get_playbook_rules with category '${wanted}', or get_rule with one of its pages: ${spec.rules.filter(r => r.category === wanted).map(r => r.slug).join(', ')}.`);
        }
        throw new Error(`Unknown rule '${trunc(slug)}'. Available: ${spec.rules.map(r => r.slug).join(', ')}.`);
      }
      const { examples, ...page } = rule;
      return args.include_examples === true ? { ...page, examples } : page;
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
