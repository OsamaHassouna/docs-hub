# Contributing

Thanks for your interest in the Email Playbook. This repo is both a docs site ([docs.osamahassouna.com](https://docs.osamahassouna.com)) and the source of the `email-playbook-mcp` npm package. They share one source of truth, so a small workflow rule keeps everything in sync.

## The golden rule: edit the MDX, never the spec

All playbook content lives in `src/content/docs/email-playbook/**/*.mdx`. A build step extracts it into a canonical `mcp/data/playbook-spec.json`, which feeds every surface:

```
src/content/docs/email-playbook/*.mdx
          │  (mcp/build/extract.mjs)
          ▼
   mcp/data/playbook-spec.json     ← generated, do NOT hand-edit
          │
          ├─▶ mcp/src/tools.mjs      → MCP server (stdio) + CLI
          ├─▶ src/pages/api/mcp.ts   → hosted JSON-RPC endpoint
          └─▶ src/lib/gemini-prompt.ts (via gen-prompt.mjs) → image-to-email prompt
```

`playbook-spec.json` and `gemini-prompt.ts` are generated artifacts. If you edit them by hand your change will be overwritten on the next build. Edit the MDX instead.

## Local setup

```bash
npm install
npm run dev        # local dev server (regenerates the spec first)
npm run build      # production build (prebuild regenerates the spec)
npm run build:spec # regenerate spec + prompt only, without building the site
```

Node 18+ is required (the MCP package declares `engines.node >= 18`).

## Making a content change

1. Edit the relevant `.mdx` under `src/content/docs/email-playbook/`.
2. Run `npm run build:spec` to regenerate the spec, or just `npm run dev` (it regenerates on start).
3. Smoke-test the MCP surface: `node mcp/test/probe.mjs` from the repo root — it spawns the server, lists tools, calls each one, and checks the error path.
4. For visual or CSS changes, verify the rendered output locally (curl the built HTML and/or a headless screenshot) before opening a PR. A clean build is not proof a page renders correctly.

## Code / endpoint changes

- API routes live in `src/pages/api/` (`mcp`, `generate-email`, `stats`, `feedback`).
- Shared MCP logic is in `mcp/src/tools.mjs` — keep it transport-agnostic so the stdio server, CLI, and hosted endpoint stay identical.
- Counter / KV code must fail open: a storage error should never break a tool call or generation.

## Pull requests

- Keep PRs focused — one logical change per PR.
- Update `CHANGELOG.md` under `## [Unreleased]` for any user-facing change.
- If you bump the MCP package version, do it in `mcp/package.json` and move the `[Unreleased]` notes into a new version section.
- Don't commit generated artifacts as the *intent* of a PR; they'll regenerate. (They are tracked so the deploy doesn't need a build step, but the MDX is the change.)

## Reporting issues

Use the issue templates (bug report / feature request). For email-rendering bugs, please name the client (e.g. "Outlook 2019 Windows", "Gmail web") — that's the single most useful detail.

## License

By contributing you agree your contributions are licensed under the repository's [MIT License](LICENSE).
