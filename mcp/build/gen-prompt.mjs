#!/usr/bin/env node
/**
 * playbook-spec.json -> src/lib/gemini-prompt.ts
 *
 * Reads the canonical PlaybookSpec and emits a TypeScript module exporting
 * a SYSTEM_PROMPT constant. The Phase 1 /api/generate-email endpoint imports
 * this constant — keeping the Gemini system prompt in sync with the playbook
 * content automatically.
 *
 * Run via the build:spec npm script (which chains: extract -> gen-prompt).
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const SPEC_PATH = join(REPO_ROOT, 'mcp', 'data', 'playbook-spec.json');
const OUT_DIR = join(REPO_ROOT, 'src', 'lib');
const OUT_PATH = join(OUT_DIR, 'gemini-prompt.ts');

const HEADER = `You are an HTML email engineer. Convert the uploaded design image into a production-ready HTML email that renders correctly across Gmail, Outlook (2007+ on Windows), Apple Mail, and Yahoo.

You have been given the complete Osama Hassouna HTML Email Playbook below. It is the COMPLETE specification — do not apply general web-development or email-development knowledge from your training. Use ONLY patterns described below. If something isn't covered, fall back to the simplest valid table (<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">).

Read the ABSOLUTE RULES section first. It overrides instinct.`;

function rulesByCategory(spec, category) {
  return spec.rules.filter(r => r.category === category);
}

function sectionForRule(rule) {
  return [`## ${rule.title}\n`, rule.description ? `_${rule.description}_\n` : '', `\n${rule.body_md}\n`].join('');
}

function sectionForComponent(comp) {
  const lines = [];
  lines.push(`## ${comp.title} (component: \`${comp.name}\`)`);
  if (comp.description) lines.push(`_${comp.description}_`);
  lines.push('');
  lines.push(`**Slots:** ${comp.slots.join(', ') || 'none'}`);
  lines.push(`**Requires VML:** ${comp.requires_vml} · **Responsive:** ${comp.responsive}`);
  lines.push('');
  if (comp.html && comp.html.trim()) {
    lines.push('Primary HTML pattern:');
    lines.push('');
    lines.push('```html');
    lines.push(comp.html);
    lines.push('```');
    lines.push('');
  }
  if (comp.body_md) {
    lines.push(comp.body_md);
    lines.push('');
  }
  return lines.join('\n');
}

// The playground generator returns only body markup; the endpoint wraps it in
// this shell. Built from the first example of each page, so the playbook stays
// the single source. Fails the build rather than ship a broken shell.
function buildShell(spec) {
  const firstExample = (slug) => spec.rules.find((r) => r.slug === slug)?.examples?.[0]?.code ?? '';
  const head = firstExample('structure/head');
  const headEnd = head.indexOf('</head>');
  const bodyOpen = firstExample('structure/body-container').match(/<body\b[^>]*>/)?.[0];
  if (!head.trimStart().startsWith('<!DOCTYPE') || headEnd === -1 || !bodyOpen) {
    throw new Error('[gen-prompt] cannot build EMAIL_SHELL: the first example of structure/head must run from <!DOCTYPE to </head>, and structure/body-container must open with a <body> tag');
  }
  // The endpoint swaps the first lang="en" for the RTL lang and dir, so it must
  // be the <html> tag's own attribute (not xml:lang, not missing).
  const htmlTag = head.match(/<html\b[^>]*>/);
  const langAt = head.indexOf('lang="en"');
  const langOnHtml = htmlTag && langAt > htmlTag.index && langAt < htmlTag.index + htmlTag[0].length && /\s/.test(head[langAt - 1]);
  if (!langOnHtml) {
    throw new Error('[gen-prompt] cannot build EMAIL_SHELL: the <html> tag in structure/head must carry lang="en" as its first lang attribute');
  }
  return {
    before: `${head.slice(0, headEnd + '</head>'.length)}\n${bodyOpen}\n`,
    after: '\n</body>\n</html>\n',
  };
}

function build() {
  const spec = JSON.parse(readFileSync(SPEC_PATH, 'utf8'));

  const out = [];
  out.push(HEADER);
  out.push('');

  // 1. ABSOLUTE RULES (ai-generation)
  out.push('# ABSOLUTE RULES');
  out.push('');
  out.push('These rules sit above the engineering patterns. Violations override visual instinct.');
  out.push('');
  for (const rule of rulesByCategory(spec, 'ai-generation')) {
    out.push(sectionForRule(rule));
  }

  // 2. COMPATIBILITY (the most common failure mode area)
  out.push('# COMPATIBILITY PATTERNS');
  out.push('');
  out.push('Cross-client constraints that drive layout. Read RESPONSIVE first — the 3-table-level wrapper is the canonical shell for every email.');
  out.push('');
  for (const rule of rulesByCategory(spec, 'compatibility')) {
    out.push(sectionForRule(rule));
  }

  // 3. STRUCTURE
  out.push('# STRUCTURE PATTERNS');
  out.push('');
  out.push('The bones of every email — doctype, head boilerplate, header/body/footer organization.');
  out.push('');
  for (const rule of rulesByCategory(spec, 'structure')) {
    out.push(sectionForRule(rule));
  }

  // 4. PRODUCTION
  out.push('# PRODUCTION RULES');
  out.push('');
  out.push('Pre-send constraints — Gmail clipping, dark mode, preheader, bulletproof buttons.');
  out.push('');
  for (const rule of rulesByCategory(spec, 'production')) {
    out.push(sectionForRule(rule));
  }

  // 5. COMPONENTS
  out.push('# COMPONENTS');
  out.push('');
  out.push('Reusable HTML patterns. When a component appears in the source design, paste the primary HTML pattern and fill the slots from the source content.');
  out.push('');
  for (const comp of spec.components) {
    out.push(sectionForComponent(comp));
  }

  // Final reminder block — repeated at the end because LLMs forget early-prompt rules.
  out.push('');
  out.push('# FINAL REMINDERS');
  out.push('');
  out.push('- Reproduce ONLY what is visible in the source image. No invented footers, no boilerplate, no rearrangement.');
  out.push('- All images are placehold.co solid color blocks at the source dimensions (https://placehold.co/{W}x{H}/E0E0E0/E0E0E0/png). Keep the /png: the default SVG does not show in Gmail apps or older Outlook. NEVER use example.com, NEVER invent CDN URLs.');
  out.push('- Text you can read in the design stays live HTML text, even on a coloured banner or header: a coloured block with a headline, or a wordmark in a plain font, is a bgcolor cell with that text, never a placeholder image. Of the elements with text in them, only logos with artwork or custom lettering are images. Photos, illustrations and icons stay placeholders.');
  out.push('- Side-by-side columns (cards, image + text): copy the hybrid row from compatibility/responsive exactly. font-size:0 wrapper div, so every text cell inside sets its own font-size and each column div sets text-align to the reading start (left, or right for dir="rtl"); each column max-width = row width / number of columns, rounded down with the remainder on the last column, and nothing subtracted for the gutter; the gutter is padding inside the columns; no spacer div or ghost-table spacer cell between columns.');
  out.push('- All link href targets use {{token}} placeholders, NEVER https://example.com/... and NEVER invented real URLs. Standard tokens: {{cta_url}}, {{unsubscribe_url}}, {{preferences_url}}, {{view_in_browser_url}}, {{logo_url}}. Use the vocabulary from ai-generation/link-tokens.');
  out.push('- Personalization fields visible in the source (e.g. [Name], {first_name}) are reproduced as {{employee_name}} / {{recipient_name}} / equivalent token, not as literal text.');
  out.push('- Use the 3-table-level wrapper from compatibility/responsive. Inner tables are ALWAYS width="100%" — never width="600".');
  out.push('- Wrap the container in an MSO ghost-table for Outlook (compatibility/outlook).');
  out.push('- Return ONLY the markup that goes inside <body> (see OUTPUT SCOPE). No markdown fences, no commentary.');
  out.push('- If the source is not an email design, return: {"error":"This does not appear to be an email design. Upload a screenshot of an email."}');

  // Last on purpose, like the reminders. Gemini 3.x blocks a whole answer as
  // RECITATION when it reproduces the long fixed head boilerplate verbatim
  // (2026-10-16), so the server owns that part. MCP users still follow Output
  // Format as written; this override is only for the playground generator.
  out.push('');
  out.push('# OUTPUT SCOPE (this generator; overrides Output Format and every rule above that asks for a complete HTML document)');
  out.push('');
  out.push('Output ONLY the markup that goes inside <body>: the wrapper div and the email tables, starting with the preheader if the design has one. No <!DOCTYPE>, no <html>, no <head>, no <body> tag. The server wraps your output in the playbook head and body shell from structure/head and structure/body-container.');
  out.push('Head CSS the playbook calls for (media queries from compatibility/responsive, dark-mode rules from production/dark-mode, MSO-only fixes from compatibility/outlook, each with its conditional comment if it has one) goes in <style> blocks before the markup. The server moves them into the head. Do not repeat CSS the playbook head already has.');
  out.push('Everything else in Output Format still applies: no markdown fences, no commentary, and the JSON error object when the image is not an email design.');

  const prompt = out.join('\n');
  const shell = buildShell(spec);

  const tsModule = `// AUTO-GENERATED from mcp/data/playbook-spec.json by mcp/build/gen-prompt.mjs.
// Do not edit by hand. Re-run \`npm run build:spec\` (chains extractor + this generator).
// Source of truth: src/content/docs/email-playbook/**/*.mdx

export const SYSTEM_PROMPT = ${JSON.stringify(prompt)};

// The document around the generator's body markup: structure/head up to
// </head>, then the <body> tag from structure/body-container.
export const EMAIL_SHELL = ${JSON.stringify(shell, null, 2)};

export const PROMPT_META = {
  generated_at: ${JSON.stringify(new Date().toISOString())},
  spec_version: ${JSON.stringify(spec.version)},
  rule_count: ${spec.rules.length},
  component_count: ${spec.components.length},
  approx_chars: ${prompt.length},
};
`;

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_PATH, tsModule, 'utf8');

  console.log(`[gen-prompt] wrote ${OUT_PATH}`);
  console.log(`              ${prompt.length} chars · ~${Math.round(prompt.length / 4)} tokens`);
}

build();
