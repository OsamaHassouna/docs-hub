# email-playbook-mcp

An [MCP](https://modelcontextprotocol.io/) server **and** terminal CLI that expose the [HTML Email Playbook](https://docs.osamahassouna.com/email-playbook/) as structured tools. AI clients can pull deterministic rules and component patterns into their reasoning; developers can query the same content from the terminal.

## Install

```bash
npm install -g email-playbook-mcp
```

Ships two binaries from one package:

- `email-playbook-mcp` — MCP server, stdio transport, for Claude Desktop / Cursor / Cline.
- `email-playbook` — terminal CLI for direct query + scripting.

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

## CLI

```bash
email-playbook --help

email-playbook list-categories
email-playbook get-rules structure
email-playbook list-components
email-playbook get-component buttons | jq '.slots'
```

Output is pretty-printed JSON to stdout. Exit codes: `0` success, `1` runtime error, `2` usage error.

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
