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
  out.push('- All images are placehold.co solid color blocks at the source dimensions. No external URLs.');
  out.push('- Use the 3-table-level wrapper. Inner tables are ALWAYS width="100%" — never width="600".');
  out.push('- Return ONLY the raw HTML document. No markdown fences, no commentary.');
  out.push('- If the source is not an email design, return: {"error":"This does not appear to be an email design. Upload a screenshot of an email."}');

  const prompt = out.join('\n');

  const tsModule = `// AUTO-GENERATED from mcp/data/playbook-spec.json by mcp/build/gen-prompt.mjs.
// Do not edit by hand. Re-run \`npm run build:spec\` (chains extractor + this generator).
// Source of truth: src/content/docs/email-playbook/**/*.mdx

export const SYSTEM_PROMPT = ${JSON.stringify(prompt)};

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
