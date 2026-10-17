#!/usr/bin/env node
/**
 * email-playbook — terminal CLI over the same tools as the MCP server.
 *
 * Commands map 1:1 to MCP tools, and the MCP tool names work too
 * (list_categories, get_playbook_rules, get_rule, ...):
 *   email-playbook list-categories
 *   email-playbook get-rules <category> [--checklist]
 *   email-playbook get-rule <slug> [--examples]
 *   email-playbook list-components
 *   email-playbook get-component <name>
 *
 * Output is pretty-printed JSON to stdout (markdown with --md on get-rules /
 * get-rule). Errors go to stderr.
 * Exit codes: 0 ok, 1 runtime error, 2 usage error.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadSpec, runTool } from './tools.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));

function buildHelp() {
  let spec;
  try {
    spec = loadSpec();
  } catch {
    spec = { categories: [], components: [] };
  }
  // Only categories with at least one rule are valid for get-rules.
  const ruleCats = spec.categories
    .filter(c => c.slug !== 'components' && c.page_count > 0)
    .map(c => c.slug)
    .join(' | ');
  const compNames = spec.components.map(c => c.name).join(' | ');

  return `email-playbook v${PKG.version}  ·  ${spec.categories.length} categories  ·  ${spec.rules?.length ?? 0} rule pages  ·  ${spec.components.length} components

Usage:
  email-playbook <command> [args]

Commands:
  list-categories                List rule categories, their page counts and page slugs.
  get-rules <category>           Print all rule pages in one category.
                                   category: ${ruleCats}
    --checklist                    Titles and the rules to follow only, no body or code.
                                   Leave out the category for every page.
  get-rule <slug>                Print one rule page (body includes its code).
                                   slug: e.g. compatibility/responsive, or just responsive
    --examples                     Also print the code examples as a separate array.
  list-components                List all reusable email components with metadata.
  get-component <name>           Print the full record for one component.
                                   name: ${compNames}

  The MCP tool names work as commands too: list_categories, get_playbook_rules,
  get_rule, list_components, get_component (and get-playbook-rules).

Options:
  --markdown, --md               get-rules / get-rule: print readable markdown, not JSON.
  -h, --help, help               Show this help.
  -v, --version, version         Print the installed version.

Examples:
  email-playbook list-categories
  email-playbook get-rules --checklist --md
  email-playbook get-rule responsive --md
  email-playbook get-component buttons | jq '.slots'

Same content as the MCP server (email-playbook-mcp) and the hosted endpoint at
https://docs.osamahassouna.com/api/mcp. Source of truth: the HTML Email Playbook
at https://docs.osamahassouna.com/email-playbook/`;
}

const HELP = buildHelp();

const COMMAND_ALIASES = { 'get-playbook-rules': 'get-rules' };

const MARKDOWN_FLAGS = ['--markdown', '--md'];
const wantsMarkdown = (flags) => flags.some(f => MARKDOWN_FLAGS.includes(f));

function fail(msg, code = 2) {
  process.stderr.write(`email-playbook: ${msg}\n`);
  if (code === 2) process.stderr.write(`\nRun \`email-playbook --help\` for usage.\n`);
  process.exit(code);
}

function printJson(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

// --markdown: a rule page (or its checklist) as text a person reads in a
// terminal, instead of JSON with the markdown in one escaped string.
function ruleMarkdown(page) {
  const lines = [`# ${page.title}`, '', page.description, '', `\`${page.slug}\``, '', '**Checklist**', ''];
  lines.push(...page.checklist.map(item => `- ${item}`));
  if (page.body_md) lines.push('', '---', '', page.body_md);
  return lines.join('\n');
}

function printMarkdown(pages) {
  process.stdout.write(pages.map(ruleMarkdown).join('\n\n') + '\n');
}

async function main() {
  const argv = process.argv.slice(2);

  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help' || argv[0] === 'help') {
    process.stdout.write(HELP + '\n');
    process.exit(0);
  }

  if (argv[0] === '-v' || argv[0] === '--version' || argv[0] === 'version') {
    process.stdout.write(PKG.version + '\n');
    process.exit(0);
  }

  const [rawCommand, ...rest] = argv;
  // MCP tool names (list_categories) and CLI names (list-categories) are the
  // same command; get-playbook-rules is the long form of get-rules.
  const normalized = rawCommand.toLowerCase().replace(/_/g, '-');
  const command = Object.hasOwn(COMMAND_ALIASES, normalized) ? COMMAND_ALIASES[normalized] : normalized;
  // No slug, category or component name starts with '-', so any such word is
  // a flag: `-x` gets "doesn't take", not a lookup of a rule named '-x'.
  const flags = rest.filter(a => a.startsWith('-'));
  const args = rest.filter(a => !a.startsWith('-'));
  // Every known command calls this first, so `<command> --help` (or -h)
  // prints the help instead of a usage error.
  const allowFlags = (allowed) => {
    if (flags.includes('--help') || flags.includes('-h')) {
      process.stdout.write(HELP + '\n');
      process.exit(0);
    }
    const bad = flags.find(f => !allowed.includes(f));
    if (bad) fail(`'${command}' doesn't take '${bad}'.`);
  };

  try {
    switch (command) {
      case 'list-categories': {
        allowFlags([]);
        if (args.length > 0) fail(`'list-categories' takes no arguments.`);
        printJson(await runTool('list_categories', {}));
        return;
      }

      case 'get-rules': {
        allowFlags(['--checklist', ...MARKDOWN_FLAGS]);
        const checklist = flags.includes('--checklist');
        if (args.length > 1 || (args.length === 0 && !checklist)) {
          fail(`'get-rules' requires a category argument (or --checklist alone, for every page).`);
        }
        const rules = await runTool('get_playbook_rules', {
          ...(args.length ? { category: args[0] } : {}),
          format: checklist ? 'checklist' : 'full',
        });
        if (wantsMarkdown(flags)) printMarkdown(rules);
        else printJson(rules);
        return;
      }

      case 'get-rule': {
        allowFlags(['--examples', ...MARKDOWN_FLAGS]);
        if (args.length !== 1) fail(`'get-rule' requires a rule slug argument.`);
        if (wantsMarkdown(flags) && flags.includes('--examples')) {
          fail(`'--examples' and '--markdown' don't combine: the markdown body already has the code.`);
        }
        const page = await runTool('get_rule', { slug: args[0], include_examples: flags.includes('--examples') });
        if (wantsMarkdown(flags)) printMarkdown([page]);
        else printJson(page);
        return;
      }

      case 'list-components': {
        allowFlags([]);
        if (args.length > 0) fail(`'list-components' takes no arguments.`);
        printJson(await runTool('list_components', {}));
        return;
      }

      case 'get-component': {
        allowFlags([]);
        if (args.length !== 1) fail(`'get-component' requires a component name argument.`);
        printJson(await runTool('get_component', { name: args[0] }));
        return;
      }

      default:
        fail(`unknown command '${rawCommand}'.`);
    }
  } catch (err) {
    fail((err instanceof Error ? err.message : String(err)), 1);
  }
}

main().catch(err => {
  fail((err instanceof Error ? err.message : String(err)), 1);
});
