# PLAN — Playground Vision (Phases 1-3)

Living plan for evolving the docs-hub Email Playbook tooling.
Last updated: 2026-05-28.

**Status:** Phase 1 SHIPPED 2026-05-28. Phase 2 is next.

---

## Vision

Cover every angle of email creation:

1. **Docs** (shipped 2026-05-22) — learn how to build emails
2. **Playground** (shipped 2026-05-26) — code-first sandbox with live preview
3. **Image to Email** (**SHIPPED 2026-05-28**) — paste/upload screenshot, get playbook-compliant HTML
4. **CLI / MCP** (Phase 2 — next) — AI clients consume the playbook as structured rules to build emails
5. **Visual Editor** (Phase 3 — gated on usage) — full form-driven section/row/component builder

The 4 surfaces give docs + playground + AI assist + non-tech UI = every entry point covered.

---

## Decisions made (2026-05-28)

- Merge Builder + Playground into one tool, but **not now** — Phase 3
- Lock current `EmailBuilder.astro` (form-driven 4-template generator) behind "coming soon"
- Drop MJML equivalent in HTML view (quality html-to-mjml doesn't exist)
- Code tab stays editable as today (no two-way binding to a form)
- Phase 1 = paste/upload image only. **No Figma URL input** (collapses to "Cmd+Shift+C in Figma, paste here")
- One Vercel serverless function holds the Gemini API key. Not a real backend, just a key proxy
- Gemini 2.5 Flash on free tier, no rate limiting at launch
- Vercel KV daily counter + Vercel Analytics for traffic monitoring
- Use the tool on real work emails to dogfood before public push

---

## Phase 1 — Image to Email — SHIPPED 2026-05-28

**Goal:** User pastes/uploads an image of an email design. System returns playbook-compliant HTML. Result drops into the existing Playground editor.

**Actual effort:** ~1 day (7 steps + 7 sub-agent reviews + 4 post-ship polish cycles).

**Live at:** https://docs.osamahassouna.com/email-playbook/playground/ "From Image" tab.

**Shipped commits:** `bddba1a..720d444` on `main`. Full details + gotchas in `memory/project_docs_hub.md`.

**Lessons applied / learned during ship** (see also `memory/feedback_verify_before_deploy.md`):
- Astro 6 dropped `output: 'hybrid'`. Use default `output: 'static'` + `adapter: vercel()`, opt routes into SSR via `export const prerender = false`.
- Starlight 0.32+ renamed sidebar wrapper class from `.sl-sidebar-content` to `.sidebar-content`. All my custom sidebar CSS using the old name had been dead since scaffold — verify rendered DOM, don't trust prior code.
- Starlight `[hidden]` is overridden by `display: flex` on children — add scoped `[hidden] { display: none !important; }`.
- Starlight `attrs: { 'data-locked': 'true' }` didn't reach the rendered `<a>` in 0.39. Use href-based selectors instead.
- Starlight `badge` "default" variant inherits the theme accent color (became an amber pill here). Use `::after` pseudo for icons instead of badges.
- `@vercel/kv` is being deprecated. Use `@upstash/redis` directly; env vars are still `KV_REST_API_URL` / `KV_REST_API_TOKEN`. Marketplace Upstash + `us-east-1` to match Vercel Hobby SSR `iad1`.
- Gemini hardcodes `width="600"` on inner tables unless mobile-responsive is a CRITICAL section in the prompt. The right shape is OUTER `width="100%"` → CONTAINER `width="600" max-width:600px;width:100%` → INNER `width="100%"`.
- Gemini invents footers/sender-lines unless told CRITICALLY: reproduce ONLY content visible in the source.
- Use `placehold.co/{W}x{H}/E0E0E0/E0E0E0` solid color blocks (no `?text=` param) for image placeholders so small icons don't show garbled text.
- Hide the AI provider name in every user-facing string (status, errors, page copy). Internal type names are fine.
- **NEW STANDING RULE:** verify visual/CSS changes locally with curl-rendered-DOM + headless Chrome screenshot BEFORE `git push`. Build-clean is not enough.

### Steps

#### 1. Lock the current form-builder behind "coming soon"
- Edit `src/content/docs/email-playbook/builder.mdx`: replace `<EmailBuilder />` with a placeholder card explaining "Visual editor — Phase 3, coming soon"
- Keep `src/components/EmailBuilder.astro` in repo (reused in Phase 3)
- Sidebar entry in `astro.config.mjs` stays so users see what's coming

#### 2. Set up Vercel SSR for one endpoint
- Install `@astrojs/vercel`
- In `astro.config.mjs`: switch to `output: 'hybrid'` + `adapter: vercel()`
- All existing static pages stay prerendered
- New `/api/generate-email` endpoint will be SSR via `export const prerender = false`

#### 3. Build the Gemini API endpoint
- File: `src/pages/api/generate-email.ts`
- Accepts POST with JSON body: `{ image: base64String, mimeType: string }`
- Calls Gemini 2.5 Flash `generateContent` with multimodal input
- System prompt embeds playbook conventions (see skeleton below)
- Returns `{ html: string }` on success or `{ error: string }` on failure
- Env var `GEMINI_API_KEY` set in Vercel project settings (NOT in repo)
- Increments Vercel KV daily counter (see step 5)

#### 4. Add "From Image" tab in the Playground
- Edit `src/components/EmailPlayground.astro`
- New tab next to existing tabs
- UI elements:
  - Paste zone (listen for window `paste` event, read clipboard ImageData)
  - File input (drag-drop or click)
  - Image thumbnail preview after upload
  - "Generate" button (disabled during call)
  - Spinner / progress state
  - Error state with retry
- On success: result HTML replaces editor content via `htmlEditor.setValue(html)`, auto-switches user to HTML tab so they see the code
- Re-use existing iframe preview pipeline — no new preview code

#### 5. Vercel KV daily counter (lightweight)
- Provision Vercel KV (Hobby free tier — 30k commands/month, 256MB)
- In `/api/generate-email`: `await kv.incr(\`daily:${new Date().toISOString().slice(0,10)}\`)`
- New `/api/stats?token=xxx` endpoint reads recent 30 days, sums them
- Token is an env-var secret so the stats endpoint isn't public
- Optional small `/admin/stats` page hits this endpoint client-side with token in URL hash

#### 6. Turn on Vercel Analytics
- Add `@vercel/analytics` package
- Inject the Web tracker (lazy script)
- Honors `feedback_vercel_analytics`: expect 5-10 min propagation delay + 20-40% adblock undercount

#### 7. Update copy on the Playground landing
- New blurb: "Or paste an email design image and we'll build it for you"
- Small "From Image" call-out card on the Playbook overview page

### Gemini prompt skeleton (refine during build)

```
You are an HTML email engineer. Convert the uploaded design image into a
production-ready HTML email following these conventions:

STRUCTURE
- 600px max-width container, centered with table layout
- All layout uses tables (no flexbox, no grid)
- Inline styles only — no <style> in <body>

HEAD
- <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" ...>
- Include MSO conditionals for Outlook
- meta viewport, charset utf-8, x-apple-disable-message-reformatting

COMPONENTS
- Buttons: bulletproof VML buttons (table + MSO conditional)
- Images: explicit width/height, alt text, display:block
- Spacers: empty <td> with explicit height + font-size:1px + line-height:1px

COMPATIBILITY
- Outlook: VML for any rounded corners or background images
- Dark mode: meta name="color-scheme" content="light dark"
- Gmail clipping: keep under 102KB

OUTPUT
- Single complete HTML document, no markdown fence, no commentary
- If the image is unclear or not an email design, return JSON: { "error": "..." }
```

The actual system prompt should be assembled by concatenating the relevant playbook page bodies at build time (so the prompt always reflects current docs).

### Done criteria

- Locked Builder placeholder renders correctly
- `/api/generate-email` accepts an image, calls Gemini, returns HTML
- "From Image" tab in Playground works end-to-end on desktop + mobile
- KV counter increments per call
- Vercel Analytics dashboard shows page views for `/playground` and event counts
- One real test: paste a Mailchimp or Stripe email screenshot, get HTML that renders cleanly in the Playground preview
- Memory updated (`project_docs_hub.md` + MEMORY.md status line)

---

## Phase 2 — CLI / MCP — SHIPPED 2026-05-28

**Goal:** AI clients (Claude Desktop, Cursor, etc.) consume the playbook as structured rules and build emails directly.

**Live:**
- npm package: [`email-playbook-mcp@0.1.0`](https://www.npmjs.com/package/email-playbook-mcp) (published under `osama_hassouna`)
- Hosted JSON-RPC: `https://docs.osamahassouna.com/api/mcp`
- Docs: `https://docs.osamahassouna.com/email-playbook/cli/`

**Shape:**
- 4 read-only tools: `list_categories`, `get_playbook_rules({category})`, `list_components`, `get_component({name})`.
- Components return rich metadata (subcategory, slots, requires_vml, responsive) not just HTML strings — keeps the system composable for Phase 3.
- Architecture: MDX → canonical `mcp/data/playbook-spec.json` IR → shared `tools.mjs` → stdio server (npm) + Astro `/api/mcp` (hosted). Single source of truth, no transport coupling.
- License: MIT.

**Phase 2.5 also SHIPPED 2026-05-28 — CLI wrapper.** Same npm package (`email-playbook-mcp@0.2.0`) now ships a second bin `email-playbook` for terminal usage. Commands match MCP tool names 1:1 (`list-categories`, `get-rules <category>`, `list-components`, `get-component <name>`). Shared `tools.mjs` core, no duplication.

---

## Phase 2.7 — Playbook completeness + single source of truth (2026-05-28)

**Driver:** smoke-testing the CLI by hand-assembling an Arabic RTL email surfaced four content gaps in the playbook AND one architectural smell — the Phase 1 Gemini system prompt was duplicating rules that should live in the playbook MDX, guaranteeing drift.

**Goal:** every rule lives in playbook MDX → spec → MCP/CLI/hosted/Gemini prompt. Zero duplication.

### Steps (executing now)

1. **Enhance `compatibility/responsive.mdx`** — name the "hybrid 3-table-level wrapper" pattern (outer 100% → container 600+max-width → inner 100%). Document the `.stack` padding gotcha: setting `display:block;width:100%` on a `<td>` with padding causes content-box overflow. Canonical fix is to put padding on an inner `<div>`, not the cell itself. `width:calc(100% - 80px)` works only when padding is fixed.
2. **Enhance `compatibility/outlook.mdx`** — add MSO ghost-table for fixed-width containers (the `<!--[if mso | IE]><table width="600">…<![endif]-->` wrapper).
3. **New `components/inline-icon.mdx`** — small icon component (phone, social) using `placehold.co` + `inline-block` + `vertical-align:middle`. Components-meta entry.
4. **New `ai-generation/` category** — top-level category for AI-meta rules currently only in the Phase 1 Gemini prompt: content fidelity (no invented footers), image placeholders (placehold.co solid blocks), output format (HTML only, error JSON shape), absolute rules (use only playbook patterns). Extend extractor + sidebar.
5. **Build-time prompt synthesis** — `mcp/build/gen-prompt.mjs` reads `playbook-spec.json` → emits `src/lib/gemini-prompt.ts` (a `SYSTEM_PROMPT` const). Phase 1 endpoint imports it. Old hardcoded prompt deleted. Hooked into `prebuild` so playbook MDX edits auto-update the prompt.
6. **Feedback endpoint** — `/api/feedback` POST stores `{ generation_id, rating: 'good' | 'bad', notes? }` to KV. Phase 1 endpoint returns a `generation_id` in the response. Playground shows thumbs up/down after generation. Foundation for future automated edge-case extraction.
7. **Verify locally + publish v0.3.0** — re-run probe + curl + screenshot. Bump mcp/package.json to 0.3.0 (additive content + new category). User runs `npm publish`.

### Decisions made this round

- **`.stack` padding fix**: use inner `<div>` wrapper for padding, NOT `width: calc(100% - Xpx)`. Cleaner, works in all clients, no client-specific quirks.
- **AI-meta rules get their own playbook category (`ai-generation`)** rather than being mixed into existing categories. Keeps email-engineering rules separate from AI-generation-conventions.
- **Prompt synthesis at build time** (not runtime). Faster, simpler, cacheable. Old `SYSTEM_PROMPT` constant in `generate-email.ts` gets replaced by import.
- **Feedback loop is 1-bit thumbs up/down** stored to KV. Pattern extraction deferred — defer until ~50+ thumbs-down examples accumulated. Captures the data so future automation has signal to learn from.

### Open question deferred — automated edge-case extraction from failed attempts

User suggested: capture failed attempts → deduce errors → add as edge cases automatically. **Defer.** Reasons: zero traffic to learn from, single failure ≠ generalizable rule, noisy rules contradict each other. Current plan: collect 1-bit feedback now (step 6), revisit pattern extraction once ~50+ thumbs-downs exist. Cheap data foundation that future automation can use.

---

## Phase 2.8 — Codex review patches (2026-05-28)

Codex review of the Phase 2.7 ship found three real gaps + four ideas worth logging but not shipping yet.

### Shipped this round (additive content, v0.4.0)

- **Link tokens** (`ai-generation/link-tokens.mdx`) — `{{cta_url}}`, `{{unsubscribe_url}}`, etc. instead of `https://example.com/...`. Fail-loud convention so review and tooling catch unfilled placeholders before send.
- **Handoff checklist** (`ai-generation/handoff-checklist.mdx`) — pre-send checklist for the human: grep `{{`, grep `placehold.co`, confirm dimensions, test clients, 102KB check.
- **Asset Policy** (`ai-generation/asset-policy.mdx`) — single page covering images + links + text personalization + why we use these conventions.
- **Version sync fix** — MCP server and hosted `/api/mcp` now read version from `mcp/package.json` instead of hardcoding (was reporting 0.1.0 when npm package was 0.2.0). Spec version (`playbook-spec.json`) also surfaced separately in the `serverInfo`.
- **Prompt header updated** — `gen-prompt.mjs` final reminders now emphasize `{{token}}` for hrefs and MSO ghost-table for the container.

### Logged for later (deferred from Codex review — pick up when usage justifies)

- **Generation modes** (editable-template / visual-fidelity / production-ready / strict-outlook / debuggable). The current implicit mode is "editable template" which is right for now. Adding 5 modes is premature scope explosion without traffic signal. Revisit when real users request specific other behaviors.
- **AI asks for image links and patches them in (conversational UX)** — adds conversational complexity. The MCP server is tool-based; the conversation about asset substitution belongs in the AI client's UX, not in the playbook spec. Revisit if multiple clients ask for it.
- **600-680px flexibility note in `compatibility/responsive`** — fair point that some designs are 640 wide. Current dogmatic 600 isn't causing any failure mode. One-sentence note next time we touch the page.
- **"Known compromises" section in `compatibility/outlook`** — `border-radius` on panels OK as graceful degradation, on buttons needs VML. Useful but better as inline asides on existing pages than a new section. Drop in next time we're touching outlook.mdx.

---

## Phase 2.9 — Codex repo audit fixes (2026-05-29)

Codex ran a static audit of the whole repo and found three real bugs + two housekeeping items. All fixed in v0.5.0.

### Shipped this round

- **Extractor regex bug fix** — `extractCodeBlocks` regex used `\s+` for code-fence metadata, which matched newlines and ate the first line of code as "title metadata" when no explicit `title="..."` attribute was present. Effect: `images` component opened at `<a>` (no `<td>`), `spacing` and `text` opened mid-row. Fix: `\s+` → `[ \t]+`. Verified post-fix: every component HTML now has balanced opening/closing wrapper tags.
- **Per-IP daily quota on `/api/generate-email`** — public endpoint was exposed to cost abuse (anyone could hammer it and burn the Gemini free tier). Added KV-backed rate limit: per-IP daily cap (default 10/day, configurable via `GENERATE_DAILY_LIMIT_PER_IP`) + global daily cap (default 200/day, `GENERATE_DAILY_LIMIT_GLOBAL`). IP is SHA-256 hashed before storage (no raw IPs). Both caps fail open if KV is unreachable — never block on infrastructure errors.
- **Token convention propagated through all code examples** — components/buttons.mdx, components/images.mdx, components/text.mdx, structure/header.mdx, structure/footer.mdx, compatibility/outlook.mdx, compatibility/responsive.mdx, compatibility/rtl.mdx, production/bulletproof-buttons.mdx all updated. `https://example.com/...` (link) → `{{cta_url}}`. `https://i.example.com/foo.png` (image) → `https://placehold.co/{W}x{H}/E0E0E0/E0E0E0`. The only remaining `example.com` references are in `ai-generation/*` pages where they're used deliberately as "don't do this" anti-examples.
- **CLI `--help` derives from spec at runtime** — `buildHelp()` reads `playbook-spec.json` and dynamically lists actual categories + component names. No more drift between published version and help text.
- **README.md (mcp/) tool table updated** with all 5 categories, all 6 components, and a paragraph explaining the new `ai-generation` category.
- **Root README.md replaced** — was still the Starlight starter README. Now explains: docs site + Playground + MCP/CLI + hosted endpoint, the build-time canonical spec architecture, common commands, repo layout, phases shipped, deployment, env vars.

### Bumped to v0.5.0

Additive content + non-breaking rate limit + dynamic help. Server, CLI, hosted endpoint, npm package all report `0.5.0` (version sync from Phase 2.8 holds).

---

## Phase 3 — Full Visual Editor

**Goal:** Section/row/component editor that merges Builder UX with Playground. The current locked Builder becomes the real Playground.

**Estimated effort:** multi-week. Only start if Phase 1 + 2 prove real usage.

### Outline

- Template picker (already in current Builder)
- Three-section frame: Header / Body / Footer
- Within each section: Add Row -> Add Component
- Component library (re-use existing playground snippet generators):
  - Spacer, Image, Text, Button, Two-column, Social, VML BG, Divider, Hero, Feature box
- Each component opens a side-panel form for its props (text, color, image URL, link, alignment)
- Drag-reorder rows
- Direction toggle (LTR/RTL) at email level
- Brand panel (colors, fonts, logo) global to the email
- "Code" tab shows generated HTML
- Templates pre-populate the section/row/component tree
- Save/load to localStorage initially, account-based later if needed

### Hard decision deferred to Phase 3 kickoff

- Code tab editability model: **eject** (switching to code loses form access) vs. **read-only preview**
- This is the single biggest design choice in Phase 3

---

## Parked ideas (do not work on)

Listed so we don't re-debate them later.

- **Figma URL as input** — collapsed to "paste image" for Phase 1. Revisit as Phase 1.5 only if real users ask for it. Requires Figma PAT, kills the paste-and-go feel.
- **MJML equivalent in HTML tab** — dropped. Quality html-to-mjml doesn't exist. Would only work if MJML were the source of truth, which it isn't.
- **Two-way binding between code tab and form** — dropped for Phase 3. Either code is eject-only or form is the only authoring path. Decide at Phase 3 kickoff.
- **Rate limiting on launch** — deferred. Ship without it. Watch the daily KV counter, add limits only if abuse appears.
- **Custom API keys for users** — deferred. Personal use first, scale concerns later.
- **Templates 4+ (announcement, receipt/invoice)** — Phase 3 work, add to component library as starter templates.
- **"Rate this page" thumbs-up mechanism** — separate small project, not part of the playground vision.
- **Generalize to a `/email-from-image` skill** — only worth it after Phase 1 ships and the prompt is stable.

---

## Related

- `project_docs_hub.md` — main project memory
- `feedback_vercel_analytics.md` — propagation delay + adblock gotchas
- `feedback_git_email.md` — make sure new commits use personal email (`eng.osama2021@gmail.com`)
