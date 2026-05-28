# email-playbook-mcp

An [MCP](https://modelcontextprotocol.io/) server that exposes the [HTML Email Playbook](https://docs.osamahassouna.com/email-playbook/) as structured tools for AI clients. The model calls deterministic tools to fetch playbook rules and component patterns, then generates emails that actually render correctly in Outlook, Gmail, and Apple Mail.

## Install

```bash
npm install -g email-playbook-mcp
```

## Configure your AI client

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

Other MCP-aware clients (Cline, Continue, Windsurf) — same shape.

## Tools

| Tool | Purpose |
|---|---|
| `list_categories` | List rule categories: structure, components, compatibility, production. |
| `get_playbook_rules` | Return full rule pages for one category — text + code examples. |
| `list_components` | List components (button, spacer, image, background-image, text) with metadata. |
| `get_component` | Return full component record — HTML pattern, slots, VML/responsive flags. |

## Hosted alternative

If you don't want to install, point any JSON-RPC 2.0 client at:

```
https://docs.osamahassouna.com/api/mcp
```

Same tools, same content. No auth.

## Why this exists

Email HTML is its own universe — tables, MSO conditionals, VML buttons, RTL mirroring, hybrid responsive. AI models generally produce broken email HTML because they don't know these rules. This server gives the model the exact patterns from a real playbook so it can compose emails correctly instead of guessing.

## License

MIT © [Osama Hassouna](https://osamahassouna.com)

## Source

- GitHub: [`OsamaHassouna/docs-hub`](https://github.com/OsamaHassouna/docs-hub) — `mcp/` directory
- Playbook: [`docs.osamahassouna.com/email-playbook/`](https://docs.osamahassouna.com/email-playbook/)
- AI integration docs: [`docs.osamahassouna.com/email-playbook/cli/`](https://docs.osamahassouna.com/email-playbook/cli/)
