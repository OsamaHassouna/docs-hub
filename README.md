# Osama Hassouna · Docs

[![npm](https://img.shields.io/npm/v/email-playbook-mcp.svg?label=email-playbook-mcp&color=cb3837)](https://www.npmjs.com/package/email-playbook-mcp)
[![license](https://img.shields.io/npm/l/email-playbook-mcp.svg)](#license)
[![MCP](https://img.shields.io/badge/MCP-2024--11--05-blue.svg)](https://modelcontextprotocol.io/)
[![docs](https://img.shields.io/badge/docs-osamahassouna.com-14110F.svg)](https://docs.osamahassouna.com)

Source for [`docs.osamahassouna.com`](https://docs.osamahassouna.com) — an engineering reference hub I keep open while building. Currently one guide is live, with more landing as I write them.

## Live now

### HTML Email Playbook

A working reference for hand-building HTML email templates that render reliably across Outlook (Windows desktop, 2007 through 365), Gmail web + mobile, Apple Mail, Yahoo Mail, and the long tail of clients that haven't moved past 2007.

Covers:

- **Structure** — doctype, head boilerplate, body container, header / body / footer organization
- **Components** — bulletproof CTA buttons (with Outlook VML fallback), spacing patterns, images, inline icons, background images, text
- **Compatibility** — Outlook MSO conditional comments, RTL languages, hybrid responsive layouts
- **Production** — Gmail 102KB clipping, dark mode, preheader text
- **AI Generation** — rules and patterns for AI tools that generate playbook-compliant email HTML

Read it: [`docs.osamahassouna.com/email-playbook/`](https://docs.osamahassouna.com/email-playbook/)

There's also a **Playground** at [`/email-playbook/playground/`](https://docs.osamahassouna.com/email-playbook/playground/) with a live editor, instant preview, and a "From Image" tab that converts a design screenshot into playbook-compliant HTML.

## Use the playbook in your AI workflow

The playbook is published as an MCP server + terminal CLI so AI clients (Claude Desktop, Cursor, Cline, etc.) can pull rules and component patterns directly into their reasoning. The model calls structured tools to fetch the exact patterns from the playbook instead of guessing from training data.

```bash
npm install -g email-playbook-mcp
```

Setup, tool reference, and Claude Desktop / Cursor config snippets:
[`docs.osamahassouna.com/email-playbook/cli/`](https://docs.osamahassouna.com/email-playbook/cli/)

There's also a hosted JSON-RPC endpoint at [`docs.osamahassouna.com/api/mcp`](https://docs.osamahassouna.com/api/mcp) if you'd rather not install anything.

## License

MIT. Playbook content © Osama Hassouna · [`osamahassouna.com`](https://osamahassouna.com)
