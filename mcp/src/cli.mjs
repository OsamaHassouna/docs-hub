#!/usr/bin/env node
/**
 * email-playbook — terminal CLI over the same tools as the MCP server.
 *
 * Commands map 1:1 to MCP tools:
 *   email-playbook list-categories
 *   email-playbook get-rules <category>
 *   email-playbook list-components
 *   email-playbook get-component <name>
 *
 * Output is pretty-printed JSON to stdout. Errors go to stderr.
 * Exit codes: 0 ok, 1 runtime error, 2 usage error.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runTool } from './tools.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));

const HELP = `email-playbook v${PKG.version}

Usage:
  email-playbook <command> [args]

Commands:
  list-categories                List all rule categories with page counts.
  get-rules <category>           Print all rules in one category.
                                   category: structure | compatibility | production
  list-components                List all reusable email components with metadata.
  get-component <name>           Print the full record for one component.
                                   name: spacing | images | background-images | buttons | text

Options:
  -h, --help                     Show this help.
  -v, --version                  Print the installed version.

Examples:
  email-playbook list-categories
  email-playbook get-rules structure
  email-playbook get-component buttons | jq '.slots'

Same content as the MCP server (email-playbook-mcp) and the hosted endpoint at
https://docs.osamahassouna.com/api/mcp. Source of truth: the HTML Email Playbook
at https://docs.osamahassouna.com/email-playbook/`;

function fail(msg, code = 2) {
  process.stderr.write(`email-playbook: ${msg}\n`);
  if (code === 2) process.stderr.write(`\nRun \`email-playbook --help\` for usage.\n`);
  process.exit(code);
}

function printJson(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

async function main() {
  const argv = process.argv.slice(2);

  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') {
    process.stdout.write(HELP + '\n');
    process.exit(0);
  }

  if (argv[0] === '-v' || argv[0] === '--version') {
    process.stdout.write(PKG.version + '\n');
    process.exit(0);
  }

  const [command, ...rest] = argv;

  try {
    switch (command) {
      case 'list-categories': {
        if (rest.length > 0) fail(`'list-categories' takes no arguments.`);
        printJson(await runTool('list_categories', {}));
        return;
      }

      case 'get-rules': {
        if (rest.length !== 1) fail(`'get-rules' requires a category argument.`);
        printJson(await runTool('get_playbook_rules', { category: rest[0] }));
        return;
      }

      case 'list-components': {
        if (rest.length > 0) fail(`'list-components' takes no arguments.`);
        printJson(await runTool('list_components', {}));
        return;
      }

      case 'get-component': {
        if (rest.length !== 1) fail(`'get-component' requires a component name argument.`);
        printJson(await runTool('get_component', { name: rest[0] }));
        return;
      }

      default:
        fail(`unknown command '${command}'.`);
    }
  } catch (err) {
    fail((err instanceof Error ? err.message : String(err)), 1);
  }
}

main().catch(err => {
  fail((err instanceof Error ? err.message : String(err)), 1);
});
