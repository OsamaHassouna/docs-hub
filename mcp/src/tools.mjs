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

// A local install can sit on an old version for months (a pinned npx
// version, a cached global install) with nothing telling the agent. This
// says so from the bundled spec's build date alone: no network call. The
// stdio server and the CLI use it; the hosted endpoint is always current
// and doesn't. EMAIL_PLAYBOOK_STALE_DAYS sets the age (default 90, 0 =
// always, for tests); EMAIL_PLAYBOOK_NO_STALE_NOTICE=1 turns it off.
export const HOSTED_MCP_URL = 'https://docs.osamahassouna.com/api/mcp';

export function staleNotice(spec, { version, audience = 'agent', env = process.env, now = Date.now() } = {}) {
  if (env.EMAIL_PLAYBOOK_NO_STALE_NOTICE && env.EMAIL_PLAYBOOK_NO_STALE_NOTICE !== '0') return null;
  const built = Date.parse(spec?.generated_at ?? '');
  if (Number.isNaN(built)) return null;
  const parsed = Number.parseInt(env.EMAIL_PLAYBOOK_STALE_DAYS ?? '', 10);
  const days = Number.isNaN(parsed) || parsed < 0 ? 90 : parsed;
  if (now - built < days * 86400000) return null;
  const builtDay = new Date(built).toISOString().slice(0, 10);
  const copy = `email-playbook-mcp v${version ?? '?'}, rules built ${builtDay}`;
  if (audience === 'human') {
    return `email-playbook: this copy (${copy}) is over ${days} days old; newer rules may exist. ` +
      `Update with: npx -y email-playbook-mcp@latest (or npm i -g email-playbook-mcp@latest). ` +
      `Hide this with EMAIL_PLAYBOOK_NO_STALE_NOTICE=1.`;
  }
  return `Update notice: this local Email Playbook (${copy}) is over ${days} days old, so newer rules and fixes may exist. ` +
    `Tell the user: set the MCP server command to \`npx -y email-playbook-mcp@latest\` (remove any pinned version), ` +
    `or switch to the hosted server ${HOSTED_MCP_URL}, which is always current. ` +
    `The rules above are still valid to use. EMAIL_PLAYBOOK_NO_STALE_NOTICE=1 hides this notice.`;
}

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

// null, "" and whitespace count as left out: some clients send one of them
// for every optional argument they don't set.
const unset = (v) => v == null || (typeof v === 'string' && v.trim() === '');

// Case and surrounding spaces don't matter in names. Non-strings pass through
// so the caller's type check still sees them.
const norm = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v);

// No slug or docs link comes close; the cap keeps the regexes below linear on
// whatever a client sends to the hosted endpoint.
const MAX_REF_LENGTH = 300;

// A slug, category or component as typed, or as a docs link from a page body
// (/email-playbook/structure/header/#background-image, with or without the
// host), reduced to its path. Non-strings pass through like norm. The query
// and anchor go first (linear at any length, and text-fragment links are
// long); a path still longer than the cap becomes a value that matches nothing.
const normRef = (v) => {
  if (typeof v !== 'string') return v;
  const path = v.replace(/[?#][\s\S]*$/, '');
  if (path.length > MAX_REF_LENGTH) return '\u0000';
  return norm(path)
    .replace(/\s*\/\s*/g, '/')
    .replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/, '')
    .replace(/^(?:[\s\S]*\/)?email-playbook\//, '')
    .replace(/^\/+|\/+$/g, '')
    .trim();
};

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
      const format = unset(args?.format) ? 'full' : norm(args.format);
      if (format !== 'full' && format !== 'checklist') {
        throw new Error(`Argument 'format' must be 'full' or 'checklist', got '${trunc(args.format)}'.`);
      }
      const checklistOf = ({ slug, title, description, checklist }) => ({ slug, title, description, checklist });
      const category = unset(args?.category) ? undefined : args.category;
      if (category !== undefined && typeof category !== 'string') {
        throw new Error("Argument 'category' must be a string.");
      }
      // Checklists for every page fit in one small call; full pages don't.
      if (category === undefined) {
        if (format === 'full') {
          throw new Error("Argument 'category' is required with format 'full'. Pass a category, or use format 'checklist' to get every page.");
        }
        return spec.rules.map(checklistOf);
      }
      const wanted = normRef(category);
      const rules = spec.rules.filter(r => r.category === wanted);
      if (rules.length === 0) {
        if (wanted === 'components' || wanted.startsWith('components/')) {
          throw new Error("Components aren't rule pages. Call list_components, then get_component with a name.");
        }
        // Body links point at pages, so a model may pass one here.
        const page = spec.rules.find(r => r.slug.toLowerCase() === wanted);
        if (page) {
          throw new Error(`'${trunc(category)}' is a page, not a category. Call get_rule with slug '${page.slug}', or get_playbook_rules with category '${page.category}'.`);
        }
        throw new Error(
          `No rules found for category '${trunc(category)}'. Available: ${Array.from(new Set(spec.rules.map(r => r.category))).join(', ')}.`,
        );
      }
      return format === 'checklist' ? rules.map(checklistOf) : rules;
    }

    case 'get_rule': {
      const slug = args?.slug;
      if (typeof slug !== 'string' || unset(slug)) {
        throw new Error("Argument 'slug' must be a non-empty string.");
      }
      if (!unset(args.include_examples) && typeof args.include_examples !== 'boolean') {
        throw new Error("Argument 'include_examples' must be a boolean.");
      }
      const wanted = normRef(slug);
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
      if (typeof compName !== 'string' || unset(compName)) {
        throw new Error("Argument 'name' must be a non-empty string.");
      }
      // Also takes the component links the page bodies use (/email-playbook/components/buttons/).
      const want = normRef(compName).replace(/^components\//, '');
      const comp = spec.components.find(c => c.name.toLowerCase() === want);
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
