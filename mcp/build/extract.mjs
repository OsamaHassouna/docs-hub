#!/usr/bin/env node
/**
 * MDX -> playbook-spec.json
 *
 * Reads MDX files under src/content/docs/email-playbook/, the components
 * metadata file, and emits a canonical PlaybookSpec at mcp/data/playbook-spec.json.
 *
 * Run via `npm run build:spec` (or directly with node).
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const DOCS_DIR = join(REPO_ROOT, 'src', 'content', 'docs', 'email-playbook');
const META_PATH = join(REPO_ROOT, 'mcp', 'data', 'components-meta.json');
const OUT_PATH = join(REPO_ROOT, 'mcp', 'data', 'playbook-spec.json');

const SOURCE_URL = 'https://docs.osamahassouna.com/email-playbook/';
// 1.1.0: rule pages gained `checklist`.
const SPEC_VERSION = '1.1.0';

// Pages that are not content (landing/index/templates page/playground/builder).
const SKIP_SLUGS = new Set(['index', 'getting-started', 'templates', 'playground', 'builder']);

// Categories advertised by the MCP `list_categories` tool. Each one is a
// surface that `get_playbook_rules` can fetch. Components live in their
// own dimension (list_components / get_component) and intentionally don't
// appear here, even though they share the components/ folder in docs.
const CATEGORIES = [
  { slug: 'structure', title: 'Structure', description: 'Doctype, head, body container, header, body, and footer — the bones every email reuses.' },
  { slug: 'compatibility', title: 'Compatibility', description: 'Where email engines diverge: Outlook MSO, RTL languages, mobile responsive.' },
  { slug: 'production', title: 'Production', description: 'Pre-send checks: Gmail 102KB clip, dark mode, preheader text, bulletproof CTAs.' },
  { slug: 'ai-generation', title: 'AI Generation', description: 'Hard constraints any AI generator follows when emitting playbook-compliant HTML — content fidelity, image placeholders, output format, absolute rules.' },
];

function walkMdx(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walkMdx(full));
    } else if (name.endsWith('.mdx')) {
      out.push(full);
    }
  }
  return out;
}

// Real YAML, the same parser (js-yaml) Astro uses for these files, so the spec
// reads every frontmatter exactly as the site does. Invalid YAML throws and the
// build stops with the page slug.
function parseFrontmatter(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return { fm: {}, body: raw };
  const fm = yaml.load(m[1]) ?? {};
  if (typeof fm !== 'object' || Array.isArray(fm)) throw new Error('frontmatter is not a YAML mapping');
  return { fm, body: m[2] };
}

// Title and description must be plain strings for the spec and the prompt.
// Trimmed: a YAML block scalar (`description: >`) keeps a trailing newline.
const text = (v) => (typeof v === 'string' ? v.trim() : '');

function extractCodeBlocks(body) {
  // ```lang[ tab/space + meta]\n  <-- meta is OPTIONAL and must NOT eat the next line
  // Using [ \t]+ explicitly (not \s+) so the regex never consumes a newline.
  const blocks = [];
  const re = /```(\w+)(?:[ \t]+([^\n]*))?\n([\s\S]*?)\n```/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const language = m[1];
    const meta = m[2] || '';
    const code = m[3];
    let title;
    const titleMatch = meta.match(/title="([^"]+)"/);
    if (titleMatch) title = titleMatch[1];
    blocks.push({ language, ...(title ? { title } : {}), code });
  }
  return blocks;
}

function cleanBody(body) {
  // Strip ESM imports
  let cleaned = body.replace(/^import\s+[^\n]+\n/gm, '');
  // Strip JSX component tags (capitalized opener/closer) but keep inner text
  cleaned = cleaned.replace(/<\/?[A-Z][a-zA-Z]*[^>]*>/g, '');
  // Collapse 3+ blank lines to 2
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  return cleaned.trim();
}

function getPrimaryHtml(blocks) {
  const htmlBlocks = blocks.filter(b => b.language === 'html');
  if (htmlBlocks.length === 0) return '';
  // Prefer the largest block (most complete pattern).
  return htmlBlocks.reduce((a, b) => (b.code.length > a.code.length ? b : a)).code;
}

function slugOf(filepath) {
  const rel = relative(DOCS_DIR, filepath).replace(/\\/g, '/');
  return rel.replace(/\.mdx$/, '');
}

function build() {
  if (!existsSync(META_PATH)) {
    console.error(`[extract] missing ${META_PATH}`);
    process.exit(1);
  }
  const metaJson = JSON.parse(readFileSync(META_PATH, 'utf8'));
  const files = walkMdx(DOCS_DIR);

  const rules = [];
  const components = [];

  for (const file of files) {
    const slug = slugOf(file);
    if (SKIP_SLUGS.has(slug)) continue;

    // Normalized: with core.autocrlf a Windows checkout has CRLF files, the
    // frontmatter regex never matches, and the spec loses every title and example.
    // A leading BOM (some Windows editors add one) does the same; Astro skips it.
    const raw = readFileSync(file, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
    let parsed;
    try {
      parsed = parseFrontmatter(raw);
    } catch (err) {
      console.error(`[extract] ${slug}: ${err.message}`);
      process.exit(1);
    }
    const { fm, body } = parsed;
    const blocks = extractCodeBlocks(body);
    const cleanedBody = cleanBody(body);

    const category = slug.split('/')[0];

    if (category === 'components') {
      const name = slug.split('/')[1];
      const meta = metaJson[name];
      if (!meta) {
        console.warn(`[extract] no metadata entry for component '${name}' — skipping`);
        continue;
      }
      components.push({
        slug,
        name,
        category: 'components',
        subcategory: meta.category,
        title: text(fm.title) || name,
        description: text(fm.description),
        body_md: cleanedBody,
        html: getPrimaryHtml(blocks),
        slots: meta.slots || [],
        requires_vml: !!meta.requires_vml,
        responsive: !!meta.responsive,
        examples: blocks,
      });
    } else if (CATEGORIES.find(c => c.slug === category)) {
      // The compact checklist mode of the MCP tools serves these. Authored in
      // each page's frontmatter, so a page without one fails the build rather
      // than ship an empty checklist.
      const { checklist } = fm;
      if (!Array.isArray(checklist) || checklist.length === 0 || checklist.some(i => typeof i !== 'string' || i.trim() === '')) {
        console.error(`[extract] ${slug}: frontmatter needs a 'checklist' list of non-empty text items`);
        process.exit(1);
      }
      rules.push({
        slug,
        category,
        title: text(fm.title) || slug,
        description: text(fm.description),
        checklist: checklist.map(i => i.trim()),
        body_md: cleanedBody,
        examples: blocks,
      });
    }
  }

  const categories = CATEGORIES.map(c => ({
    ...c,
    page_count: rules.filter(r => r.category === c.slug).length,
  }));

  const spec = {
    version: SPEC_VERSION,
    generated_at: new Date().toISOString(),
    source_url: SOURCE_URL,
    categories,
    rules,
    components,
  };

  writeFileSync(OUT_PATH, JSON.stringify(spec, null, 2) + '\n', 'utf8');
  console.log(`[extract] wrote ${OUT_PATH}`);
  console.log(`           ${categories.length} categories, ${rules.length} rules, ${components.length} components`);
}

build();
