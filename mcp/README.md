# email-playbook-mcp

[![npm](https://img.shields.io/npm/v/email-playbook-mcp.svg)](https://www.npmjs.com/package/email-playbook-mcp)
[![license](https://img.shields.io/npm/l/email-playbook-mcp.svg)](#license)
[![MCP](https://img.shields.io/badge/MCP-2024--11--05-blue.svg)](https://modelcontextprotocol.io/)

> **Stop AI models from generating broken HTML email.** This MCP server + CLI feeds them the patterns that actually render in Outlook 2007+, Gmail, and Apple Mail — drawn from the [HTML Email Playbook](https://docs.osamahassouna.com/email-playbook/).

Without it, your model invents `flex` and `grid` (no email client supports those), hardcodes table widths that overflow on mobile, forgets the VML fallback for Outlook buttons, and makes up footer disclaimers that weren't in your design.

With it, the model calls structured tools to pull the exact patterns from the playbook and composes emails using those, instead of guessing from training data.

## Install

```bash
npm install -g email-playbook-mcp
```

## Use it in Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "email-playbook": {
      "command": "email-playbook-mcp"
    }
  }
}
```

Restart Claude Desktop. The playbook tools appear in the model's tool list. Ask it to build an email and it'll call them automatically.

## Use it in Cursor

Edit `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "email-playbook": {
      "command": "email-playbook-mcp"
    }
  }
}
```

**Cline / Continue / Windsurf** and other MCP-aware clients use the same shape — point a `command` entry at `email-playbook-mcp`.

## Use it as a CLI

The same package ships a second binary for direct query + scripting:

```bash
$ email-playbook get-component buttons | jq '{name, slots, requires_vml}'
{
  "name": "buttons",
  "slots": ["text", "url", "background_color", "text_color", "width_px", "height_px"],
  "requires_vml": true
}
```

Other commands: `list-categories`, `list-components`, `get-rules <category>`. Help text is generated from the bundled spec at runtime, never stale. Run `email-playbook --help`.

## Tools

| Tool | Returns |
|------|---------|
| `list_categories` | The 5 playbook categories with page counts |
| `get_playbook_rules({ category })` | All rules in one category (text + code) |
| `list_components` | All components with metadata |
| `get_component({ name })` | One component: HTML pattern, slots, VML/responsive flags |

## What's in the playbook

| Category | Pages | Covers |
|----------|-------|--------|
| `structure` | 5 | Doctype, head, body container, header, body, footer |
| `components` | 6 | Buttons, spacing, images, inline icons, background images, text |
| `compatibility` | 3 | Outlook MSO, RTL languages, responsive |
| `production` | 4 | Gmail 102KB clip, dark mode, preheader, bulletproof buttons |
| `ai-generation` | 7 | Absolute rules, asset policy, content fidelity, image placeholders, link tokens, output format, handoff checklist |

The `ai-generation` category is the one to fetch first for image-to-email tasks. It encodes rules that override training-data instincts — use `{{cta_url}}` not `https://example.com`, reproduce only what's in the source, use `placehold.co` for every image, return HTML only.

## What it doesn't do

- **Doesn't send email** — generate the HTML here, send it through your existing platform.
- **Doesn't render previews** — the [Playground](https://docs.osamahassouna.com/email-playbook/playground/) does (with a "From Image" tab if you have a screenshot).
- **Doesn't validate existing HTML** — manual pass via the [Handoff Checklist](https://docs.osamahassouna.com/email-playbook/ai-generation/handoff-checklist/).

## Hosted alternative

No install? Point any JSON-RPC 2.0 client at `https://docs.osamahassouna.com/api/mcp`. Same tools, same content, no auth.

```bash
curl -X POST https://docs.osamahassouna.com/api/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## License

MIT © [Osama Hassouna](https://osamahassouna.com)

- [HTML Email Playbook](https://docs.osamahassouna.com/email-playbook/)
- [Install + config docs](https://docs.osamahassouna.com/email-playbook/cli/)
- [Source](https://github.com/OsamaHassouna/docs-hub) (`mcp/` directory)
