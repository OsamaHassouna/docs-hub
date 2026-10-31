# Changelog

All notable changes to the **Email Playbook** (`email-playbook-mcp` on npm + the docs hub at [docs.osamahassouna.com](https://docs.osamahassouna.com)) are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the MCP package follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Versions below refer to the `email-playbook-mcp` npm package; docs-site-only changes are noted where relevant.

## [Unreleased]

## [0.8.0] — 2026-10-31

### Added
- Playbook: **Force Light** page (`production/force-light`), the opt-in recipe for a block that stays white with black text in dark mode: a full-size hosted white image, white text with `mix-blend-mode:difference`, and a gradient text fill for classic Outlook. Lists the clients it covers and the ones where the text turns white on white.
- Playbook: **Email Signatures** page (`production/signatures`): find out the insertion path first, what the classic Outlook composer rewrites, fixed-width scoped layout, a bilingual header pattern, template tokens, missing fields, E.164 `tel:` links, hosted images, size and a test matrix.
- MCP + CLI: an update note when the bundled rules are more than 90 days old, worked out from the spec's build date with no network call. The stdio server adds it to its instructions and to the first tool result of a session; the CLI prints one stderr line. `EMAIL_PLAYBOOK_NO_STALE_NOTICE=1` turns it off, `EMAIL_PLAYBOOK_STALE_DAYS` changes the age. The hosted endpoint is always current and never shows it.
- Docs: **Case Studies** section, starting with a bilingual signature that stays white in dark mode (invented brand, real findings). Docs only; the MCP does not serve case studies.

### Changed
- Playbook: Dark Mode names two strategies (adapt by default, force light as an opt-in) and documents Outlook web's `data-ogsc` / `data-ogsb` behaviour. Gmail Clipping covers clipping caused by the charset. Background Images warns about Outlook-only CID images showing as Gmail attachments. Text covers link styles after the classic Outlook composer. RTL points to the bilingual header.
- Playground: the generator prompt leaves out the Force Light and Email Signatures pages; they are opt-in patterns, not defaults for a design-to-email conversion.

## [0.7.0] — 2026-10-17

### Added
- MCP: `get_rule` tool returns a single rule page by slug (`compatibility/responsive`, just `responsive`, or a page link from a body) instead of the whole category. A component name or link points to `get_component`.
- MCP: `get_playbook_rules` takes `format: "checklist"` for a compact list of the rules on each page; leave out `category` to get every page in one call (about 16 KB). Every rule page now carries an authored checklist.
- MCP: `list_categories` lists the slug and title of every page, so clients can find what to pass to `get_rule`.
- MCP: the server sends `instructions` on initialize (stdio and hosted) describing the checklist-first order, and every tool carries read-only `annotations`.
- CLI: the MCP tool names work as command names (`list_categories`, `get_playbook_rules`, `get_rule`, `list_components`, `get_component`), plus `get-rule <slug>`, `get-rules [category] --checklist`, `--md` for readable markdown output, and `help` / `version` commands.

### Changed
- Spec: `playbook-spec.json` version 1.1.0, with a `checklist` array on every rule page.
- MCP: `category`, `format` and component `name` ignore case and surrounding spaces. `get_component` also takes the component links the page bodies use (`/email-playbook/components/buttons/`), and a page link passed as `category` points to `get_rule`. A blank optional argument counts as left out.
- Docs site: Playground image-to-email runs on a newer model that keeps layout and content much closer to the uploaded design. When it's out of quota, a second model of the same quality takes over; when it's busy, a faster fallback model answers. Generation now takes about 1-2 minutes.
- Playbook: placeholder images are for assets you don't have. When a request supplies real image URLs (Figma exports, CDN links), generators use them as given.

### Fixed
- Playbook: placeholder images now use `placehold.co` PNG URLs (`/png`). The default SVG doesn't render in most email clients (Gmail, older desktop Outlook), so generated emails could show broken images there. The Playground also corrects any placeholder URL that comes back without it.
- Playbook: the hybrid two-column pattern keeps its columns side by side. The space between the inline-block columns pushed the second one onto a new line; the pattern now wraps them in a `font-size:0` div, makes the widths add up exactly, and puts padding on table cells, which Outlook respects, instead of `<div>`s.
- Hosted `/api/mcp` endpoint now follows the Streamable HTTP transport for the cases strict MCP clients check: notifications are answered with `202` and an empty body (was `200` with a JSON-RPC result), and a `GET` that asks for `text/event-stream` gets `405` (was `200` with the discovery JSON). A plain `GET` still returns the discovery document.
- CORS preflight on `/api/mcp` now allows the `Mcp-Protocol-Version`, `Mcp-Session-Id`, `Last-Event-ID` and `Accept` request headers, so browser-based MCP clients can connect.

## [0.6.3] — 2026-06-02

### Added
- Privacy-friendly tool-call counters on the hosted `/api/mcp` endpoint (per-tool totals + per-day rollups, no PII), surfaced through the token-gated `/api/stats` route.
- "See it work in 10 seconds" no-install curl demo and a "Safe by design" trust block on the MCP page.
- "Safe to install" trust block in the npm README — one dependency, no postinstall scripts, read-only, no inbox, no network calls of its own.
- Author-credibility section on the playbook landing.
- Community scaffolding: CHANGELOG, CONTRIBUTING, issue/PR templates, smoke tests, and CI.

### Changed
- Homepage `<title>` / `og:title` / description now lead with the product ("HTML Email Playbook + MCP for AI Clients") instead of "Docs".
- Builder page copy corrected (image-to-email is live in the Playground, not "coming in Phase 1") and removed from the sidebar nav.
- `/email-playbook/` rebuilt as a product landing; the CLI page moved to `/email-playbook/mcp/` (old `/cli/` URLs redirect), and the sidebar was regrouped into Overview / Tools / Reference.
- Cross-surface product strings centralized in `product.config.mjs`; the MCP protocol version is now single-sourced there so the hosted endpoint and the README badge can't drift.

### Security
- Playground preview iframe no longer runs with `allow-scripts` (it renders static email HTML via `srcdoc`).
- Per-route Origin (CSRF) guard on the cost-bearing `/api/generate-email` and `/api/feedback` routes; `/api/mcp` intentionally stays open to all clients.

### Fixed
- `/email-playbook/cli/` (trailing slash) returned 404; it now redirects to `/email-playbook/mcp/`.
- CI workflow ran on Node 20, which Astro rejects (requires ≥ 22.12); bumped to Node 22.

## [0.6.2] — 2026-05-30

### Added
- `mcpName` field in `package.json` and a `server.json` for the official MCP Registry; published as `io.github.OsamaHassouna/email-playbook-mcp`.
- `smithery.yaml` for Smithery auto-discovery.
- Site: `llms.txt`, `robots.txt`, and a default `og:image` (1200×630).

## [0.6.1] — 2026-05-30

### Fixed
- Image-to-email quota gate now charges the rate limit before the provider call (closes a bad-image → free generation abuse path) and uses `x-vercel-forwarded-for` for client IP.

### Added
- `LICENSE` (MIT) at the repo root.

### Changed
- Docs drift fixed: CLI page and `mcp/README.md` now match the actual four rule categories with components surfaced via `list_components`.

## [0.6.0] — 2026-05-29

### Added
- Seven GitHub releases backfilled; hosted JSON-RPC endpoint and registry groundwork.

## [0.5.0] — 2026-05-29

### Fixed
- `extractCodeBlocks` regex bug that swallowed the first line of a code block when no explicit `title=` was present.

### Added
- Per-IP + global daily quota on `/api/generate-email` (configurable, fail-open, SHA-256-hashed IPs).
- CLI `--help` derives categories and component names from the spec at runtime.

## [0.4.0] — 2026-05-28

### Added
- `ai-generation` content: link tokens (`{{cta_url}}` etc.), a pre-send handoff checklist, and an asset policy page.

### Fixed
- Version sync: server and hosted endpoint report the version from `package.json` instead of a hardcoded string.

## [0.3.0] — 2026-05-28

### Added
- New `ai-generation` rule category (content fidelity, image placeholders, output format, absolute rules).
- Build-time prompt synthesis: the Gemini system prompt is generated from the playbook spec so it can't drift.
- 1-bit thumbs feedback endpoint foundation.

## [0.2.0] — 2026-05-28

### Added
- CLI wrapper: the package now ships a second bin, `email-playbook`, mirroring the MCP tool names for terminal/script use.

## [0.1.0] — 2026-05-28

### Added
- Initial release: MCP server exposing four read-only tools (`list_categories`, `get_playbook_rules`, `list_components`, `get_component`) generated from the playbook MDX via a canonical `playbook-spec.json`.

[Unreleased]: https://github.com/OsamaHassouna/docs-hub/compare/v0.8.0...HEAD
[0.8.0]: https://github.com/OsamaHassouna/docs-hub/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/OsamaHassouna/docs-hub/compare/v0.6.3...v0.7.0
[0.6.3]: https://github.com/OsamaHassouna/docs-hub/compare/v0.6.2...v0.6.3
[0.6.2]: https://github.com/OsamaHassouna/docs-hub/compare/v0.6.1...v0.6.2
[0.6.1]: https://github.com/OsamaHassouna/docs-hub/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/OsamaHassouna/docs-hub/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/OsamaHassouna/docs-hub/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/OsamaHassouna/docs-hub/compare/v0.2.0...v0.4.0
[0.3.0]: https://github.com/OsamaHassouna/docs-hub/releases/tag/v0.3.0
[0.2.0]: https://github.com/OsamaHassouna/docs-hub/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/OsamaHassouna/docs-hub/releases/tag/v0.1.0
