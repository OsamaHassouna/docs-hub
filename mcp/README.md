# email-playbook-mcp

**AI models produce broken HTML email.** They invent table widths that overflow on mobile. They forget the VML fallback that Outlook needs for rounded buttons. They emit `flex` and `grid` that no email client supports. They make up footer disclaimers that weren't in your design.

This package gives them the rules that actually work — distilled from the [HTML Email Playbook](https://docs.osamahassouna.com/email-playbook/) — through an MCP server and a terminal CLI. The model calls structured tools to fetch playbook patterns, then composes emails that render correctly in Outlook 2007+, Gmail, Apple Mail, and Yahoo without you having to debug them after.

---

## What it looks like

**In your terminal:**

```bash
$ email-playbook list-categories
[
  { "slug": "structure",      "title": "Structure",      "page_count": 5 },
  { "slug": "components",     "title": "Components",     "page_count": 6 },
  { "slug": "compatibility",  "title": "Compatibility",  "page_count": 3 },
  { "slug": "production",     "title": "Production",     "page_count": 4 },
  { "slug": "ai-generation",  "title": "AI Generation",  "page_count": 7 }
]

$ email-playbook get-component buttons | jq '{name, slots, requires_vml}'
{
  "name": "buttons",
  "slots": ["text", "url", "background_color", "text_color", "width_px", "height_px"],
  "requires_vml": true
}

$ email-playbook get-rules ai-generation | jq -r '.[].title'
Absolute Rules
Asset Policy
Content Fidelity
Image Placeholders
Link Tokens
Output Format
Handoff Checklist
```

**In Claude Desktop or Cursor:**

You ask "Build me a transactional welcome email with a CTA button." The model calls `list_components` and `get_component({ name: "buttons" })` to fetch the bulletproof VML button pattern, calls `get_playbook_rules({ category: "compatibility" })` for the responsive layout shell, and assembles the email using those exact patterns instead of guessing from training data. The output renders correctly when you actually send it.

---

## Why this exists

HTML email is its own engineering domain. Modern CSS rules don't apply. Outlook for Windows still uses Microsoft Word's HTML engine. Gmail clips messages over 102KB. VML is the only way to get a rounded button in Outlook. RTL layouts need `dir="rtl"` on every table. The list goes on.

A model that hasn't been trained on this — and most haven't — produces HTML that looks correct in the chat window and breaks in real inboxes. The fix isn't a bigger model; it's giving the model access to the exact rules that work and explicitly forbidding training-data instincts that don't.

That's what this package does:

- **`list_categories`** — orient the model: what kinds of rules exist?
- **`get_playbook_rules({ category })`** — pull the full text and code examples for one concern (e.g., responsive layout, dark mode).
- **`list_components`** — what reusable HTML patterns are available?
- **`get_component({ name })`** — return the canonical pattern for one component (button, spacer, image, two-column row, social row, inline icon), with its slots and metadata.

The model uses these to compose, not to verify. Composition from documented patterns is dramatically more reliable than autoregressive generation from training data.

---

## Three ways to use it

### 1. As an MCP server in your AI client (recommended)

```bash
npm install -g email-playbook-mcp
```

**Claude Desktop** — edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "email-playbook": {
      "command": "email-playbook-mcp"
    }
  }
}
```

Restart Claude Desktop. The tools appear in the model's tool list automatically.

**Cursor** — edit `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "email-playbook": {
      "command": "email-playbook-mcp"
    }
  }
}
```

**Cline / Continue / Windsurf / other MCP-aware clients** — same shape. Point a `command` entry at `email-playbook-mcp`.

### 2. As a CLI in your terminal

The same package ships a second binary for direct query and scripting:

```bash
email-playbook --help                          # discover commands
email-playbook list-categories                  # orient
email-playbook get-rules compatibility          # the responsive + Outlook patterns
email-playbook get-component buttons            # the bulletproof CTA pattern
email-playbook get-component buttons | jq '.html'   # pipe into your pipeline
```

The `--help` output is generated from the bundled spec at runtime — when the package version bumps, the help text always lists the actual available categories and components.

Output is pretty-printed JSON to stdout. Exit codes: `0` success, `1` runtime error, `2` usage error.

### 3. As an HTTP endpoint (no install)

If you don't want to install anything, point any JSON-RPC 2.0 client at the hosted endpoint:

```bash
# Server info
curl https://docs.osamahassouna.com/api/mcp

# List tools
curl -X POST https://docs.osamahassouna.com/api/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# Call a tool
curl -X POST https://docs.osamahassouna.com/api/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "get_component",
      "arguments": { "name": "buttons" }
    }
  }'
```

Same tools, same content. Public — no auth required. Useful for scripts, remote agents, and AI clients that speak MCP over HTTP.

---

## What's in the playbook

The package bundles a canonical snapshot of the playbook at install time. Currently:

| Category | Pages | What it covers |
|---|---|---|
| `structure` | 5 | Doctype, head boilerplate, body container, header, body, footer |
| `components` | 6 | Buttons, spacing, images, inline icons, background images (VML), text |
| `compatibility` | 3 | Outlook & MSO, RTL support, responsive (3-table-level wrapper + MSO ghost-table) |
| `production` | 4 | Gmail 102KB clipping, dark mode, preheader text, bulletproof buttons |
| `ai-generation` | 7 | Absolute rules, asset policy, content fidelity, image placeholders, link tokens, output format, handoff checklist |

The `ai-generation` category is the one you almost certainly want first when bootstrapping an image-to-email task. It encodes the "do this / don't do that" rules that override training-data instincts — use `{{cta_url}}` not `https://example.com`, reproduce only what's in the source, use `placehold.co` for every image, return HTML only.

The components return rich metadata (subcategory, slots, `requires_vml`, `responsive`) alongside the HTML pattern — composable for downstream tooling, not just opaque strings.

---

## Example flow inside an AI client

You upload a screenshot of an email design and ask: **"Build me HTML for this. Use the email playbook tools to follow the patterns exactly."**

A typical model flow:

1. **Orient** — `list_categories` to see what's available, then `get_playbook_rules({ category: "ai-generation" })` to get the absolute rules first.
2. **Layout** — `get_playbook_rules({ category: "compatibility" })` to fetch the 3-table-level responsive wrapper + MSO ghost-table.
3. **Structure** — `get_playbook_rules({ category: "structure" })` for the doctype, head boilerplate, and section organization.
4. **Components** — `list_components`, then `get_component({ name: "buttons" })` for the CTA pattern, `get_component({ name: "spacing" })` for spacer rows, `get_component({ name: "inline-icon" })` for footer icons.
5. **Compose** — assemble the email using the exact HTML patterns from the playbook. `{{cta_url}}` for link targets, `placehold.co` for images, no invented footers.

The output renders correctly in Outlook + Gmail + Apple Mail because it never deviated from documented patterns.

---

## Configuration

Both binaries work out of the box with no configuration. Optional environment variables for the hosted endpoint (when you self-host the Astro project):

| Env var | Default | Purpose |
|---|---|---|
| `GENERATE_DAILY_LIMIT_PER_IP` | `10` | Image-to-email per-IP daily cap (sister `/api/generate-email` endpoint) |
| `GENERATE_DAILY_LIMIT_GLOBAL` | `200` | Image-to-email global daily cap |
| `STATS_TOKEN` | — | Token-gated `/api/stats` endpoint |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | — | Upstash Redis for usage counter + feedback loop |

The MCP server and CLI themselves require no configuration.

---

## Versioning

| | |
|---|---|
| **Current** | `0.5.0` |
| **MCP protocol** | `2024-11-05` |
| **Spec version** | `1.0.0` (the playbook content schema) |

Both server and CLI report their npm version automatically (no hardcoded strings). The hosted endpoint at `/api/mcp` returns both `server.version` (npm release) and `spec_version` (playbook content) as separate fields.

Breaking changes follow semver — minor versions add categories / components / fields, never remove them.

---

## Source + license

- Site: [`docs.osamahassouna.com`](https://docs.osamahassouna.com)
- Email Playbook: [`docs.osamahassouna.com/email-playbook/`](https://docs.osamahassouna.com/email-playbook/)
- AI integration docs: [`docs.osamahassouna.com/email-playbook/cli/`](https://docs.osamahassouna.com/email-playbook/cli/)
- Source: [`github.com/OsamaHassouna/docs-hub`](https://github.com/OsamaHassouna/docs-hub) (the `mcp/` directory)

MIT © [Osama Hassouna](https://osamahassouna.com)
