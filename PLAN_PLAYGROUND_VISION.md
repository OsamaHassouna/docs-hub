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

**Deferred to follow-ups (when real usage justifies):**
- `get_layout` — discrete named layouts (two-column-hero, centered-CTA, sidebar-with-content). Requires `layouts/` content section in the playbook first — this is a content problem, not a code problem.
- `analyze_html` (NOT `validate_email_html`) — return issues ("possible Outlook issue / missing VML fallback / Gmail clipping risk") instead of binary pass/fail. Less brittle than strict validation.
- `supported_clients` field on components — defer until a component exists with narrower-than-all support.

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
