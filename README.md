# docs-hub

The repository behind [`docs.osamahassouna.com`](https://docs.osamahassouna.com) — an engineering reference hub with the **HTML Email Playbook** as the first guide.

What lives here:

- **Public docs site** (Astro + Starlight) — the playbook itself, served at `docs.osamahassouna.com/email-playbook/`
- **Playground** at `/email-playbook/playground/` — Monaco editor + live preview + "From Image" tab that feeds an uploaded screenshot to Gemini 2.5 Flash and returns playbook-compliant HTML
- **MCP server package** (`mcp/`) — published as [`email-playbook-mcp`](https://www.npmjs.com/package/email-playbook-mcp). Same package ships a stdio MCP server (for Claude Desktop / Cursor / Cline) and a CLI command (`email-playbook ...`).
- **Hosted MCP endpoint** at `/api/mcp` — same tools as the stdio server, over HTTP/JSON-RPC. No install, no auth.
- **Build-time canonical spec** — MDX → `mcp/data/playbook-spec.json` → consumed by MCP, CLI, hosted endpoint, AND the Gemini system prompt. One source of truth.

---

## Architecture (single source of truth)

```
src/content/docs/email-playbook/        ← human source: MDX
            │
            ▼
mcp/build/extract.mjs                   ← parse MDX, emit spec
            │
            ▼
mcp/data/playbook-spec.json             ← canonical IR
            │
            ├──→ mcp/src/tools.mjs      ← shared core (getTools / runTool)
            │       │
            │       ├──→ mcp/src/server.mjs  (stdio MCP, published npm bin)
            │       ├──→ mcp/src/cli.mjs     (terminal CLI, published npm bin)
            │       └──→ src/pages/api/mcp.ts (hosted JSON-RPC endpoint)
            │
            └──→ mcp/build/gen-prompt.mjs    (synthesize Gemini system prompt)
                    │
                    ▼
            src/lib/gemini-prompt.ts    ← imported by /api/generate-email
```

Edit any MDX page → `npm run build:spec` regenerates the spec → every consumer updates automatically. No drift.

## Surfaces serving the playbook

| Surface | Audience | Where |
|---|---|---|
| Docs site | Browsers, search | `docs.osamahassouna.com/email-playbook/` |
| Playground | Devs, non-tech users | `docs.osamahassouna.com/email-playbook/playground/` |
| MCP (stdio) | AI clients (Claude Desktop, Cursor) | `npm install -g email-playbook-mcp` |
| CLI | Terminal devs | same package: `email-playbook --help` |
| Hosted JSON-RPC | HTTP clients, remote agents | `POST docs.osamahassouna.com/api/mcp` |

## Common commands

```bash
# Local dev (regenerates spec + prompt, then starts Astro dev server)
npm run dev

# Production build (regenerates spec + prompt, then builds)
npm run build

# Regenerate spec + prompt without starting a server
npm run build:spec

# Run MCP probe locally (spawns server, exercises every tool)
node mcp/test/probe.mjs

# Use the CLI locally before publish
node mcp/src/cli.mjs list-categories
node mcp/src/cli.mjs get-component buttons | jq '.slots'
```

## Repository layout

```
docs-hub/
├── src/
│   ├── content/docs/email-playbook/    Playbook MDX (source of truth)
│   │   ├── structure/                  Doctype, head, body container, header, body, footer
│   │   ├── components/                 Buttons, spacing, images, inline-icon, background-images, text
│   │   ├── compatibility/              Outlook & MSO, RTL, responsive
│   │   ├── production/                 Gmail 102KB, dark mode, preheader, bulletproof buttons
│   │   ├── ai-generation/              Absolute rules, asset policy, link tokens, output format, handoff checklist
│   │   ├── playground.mdx
│   │   ├── cli.mdx                     The /email-playbook/cli/ docs page (MCP + CLI install)
│   │   └── builder.mdx                 Phase 3 placeholder
│   ├── components/
│   │   ├── EmailPlayground.astro       Playground UI (Monaco + iframe + From Image tab)
│   │   └── EmailBuilder.astro          Phase 3 form-driven builder (locked)
│   ├── pages/api/
│   │   ├── generate-email.ts           Phase 1: image → HTML via Gemini 2.5 Flash + retries + rate limit
│   │   ├── mcp.ts                      Hosted MCP (JSON-RPC over HTTP)
│   │   ├── stats.ts                    Token-gated usage stats
│   │   └── feedback.ts                 1-bit thumbs up/down feedback
│   ├── lib/
│   │   ├── kv.ts                       Upstash Redis client + day-keys
│   │   └── gemini-prompt.ts            AUTO-GENERATED — synthesized prompt
│   └── styles/                         Site theme (warm cream / warm carbon editorial)
├── mcp/                                Publishable npm package
│   ├── build/
│   │   ├── extract.mjs                 MDX → playbook-spec.json
│   │   └── gen-prompt.mjs              spec → gemini-prompt.ts
│   ├── data/
│   │   ├── components-meta.json        Component metadata (slots, vml, responsive)
│   │   └── playbook-spec.json          AUTO-GENERATED canonical IR
│   ├── src/
│   │   ├── tools.mjs                   Shared core (getTools, runTool, loadSpec)
│   │   ├── server.mjs                  stdio MCP server (npm bin)
│   │   ├── cli.mjs                     Terminal CLI (npm bin)
│   │   └── types.ts                    Shared type definitions
│   └── test/probe.mjs                  End-to-end MCP probe
├── astro.config.mjs                    Sidebar config, Vercel adapter, analytics
├── PLAN_PLAYGROUND_VISION.md           Phases 1, 2, 2.5, 2.7, 2.8 (current state + future)
└── package.json                        prebuild chains: extract → gen-prompt → astro build
```

## Phases shipped

- **Phase 1** — image-to-email Playground tab + KV stats + Builder placeholder (2026-05-28)
- **Phase 2 + 2.5** — MCP server + CLI in one npm package (`email-playbook-mcp@0.2.0`)
- **Phase 2.7** — `ai-generation` category + build-time prompt synthesis + feedback endpoint (`@0.3.0`)
- **Phase 2.8** — link tokens, handoff checklist, asset policy, version sync (`@0.4.0`)

Full status and the still-queued phases (visual editor, layout patterns, `analyze_html`) live in [`PLAN_PLAYGROUND_VISION.md`](./PLAN_PLAYGROUND_VISION.md).

## Deployment

- Hosted by [Vercel](https://vercel.com), auto-deploy on push to `main`
- Static pages prerender; SSR routes are `/api/generate-email`, `/api/mcp`, `/api/stats`, `/api/feedback`
- Required env vars (set in Vercel project): `GEMINI_API_KEY`, `STATS_TOKEN`, `KV_REST_API_URL`, `KV_REST_API_TOKEN`
- Optional env vars: `GENERATE_DAILY_LIMIT_PER_IP` (default 10), `GENERATE_DAILY_LIMIT_GLOBAL` (default 200)

## License

MIT. Playbook content © Osama Hassouna. Site: [`osamahassouna.com`](https://osamahassouna.com).
