# Changelog

All notable changes to the **Email Playbook** (`email-playbook-mcp` on npm + the docs hub at [docs.osamahassouna.com](https://docs.osamahassouna.com)) are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the MCP package follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Versions below refer to the `email-playbook-mcp` npm package; docs-site-only changes are noted where relevant.

## [Unreleased]

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

[Unreleased]: https://github.com/OsamaHassouna/docs-hub/compare/v0.6.2...HEAD
[0.6.2]: https://github.com/OsamaHassouna/docs-hub/compare/v0.6.1...v0.6.2
[0.6.1]: https://github.com/OsamaHassouna/docs-hub/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/OsamaHassouna/docs-hub/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/OsamaHassouna/docs-hub/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/OsamaHassouna/docs-hub/compare/v0.2.0...v0.4.0
[0.3.0]: https://github.com/OsamaHassouna/docs-hub/releases/tag/v0.3.0
[0.2.0]: https://github.com/OsamaHassouna/docs-hub/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/OsamaHassouna/docs-hub/releases/tag/v0.1.0
