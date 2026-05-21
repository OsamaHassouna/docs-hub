# Docs Hub — Session Handoff

**Last touched:** 2026-05-21
**Status:** First scaffold shipped. Design rejected by Osama. Awaiting Stitch-driven redesign.

## What exists

- **Location:** `D:/Personal/my-website/docs-hub/`
- **Stack:** Astro 6.3 + Starlight 0.39 + MDX, Pagefind search built-in
- **Build status:** Clean. 22 pages generate in ~2.5s.
- **Dev server:** Run `npm run dev` → http://localhost:4321/
- **Production build:** `npm run build` → `dist/`

## Folder layout

```
D:/Personal/my-website/
├── osamahassouna/     (main portfolio, github.com/OsamaHassouna/osamahassouna-com)
└── docs-hub/          (this project, NOT yet pushed to GitHub)
```

Email-docx source mirror at `D:/Personal/_sources/email-docx/` (for porting reference, can delete later).

## What's REJECTED (do not restore)

Osama did not like the design from the first scaffold:
- Light primary + dark code blocks
- Fraunces serif headings + Inter body
- Amber accent (#B8651B / #E68A2E)
- Restrained animations (page-fade, scroll reveal, sidebar active slide)

Plus dark theme had multiple bugs (broken CSS, contrast issues, color choices wrong, layout issues in dark mode only).

The theme files at `src/styles/{fonts,theme,motion}.css` are the OLD direction and will be REPLACED, not patched. Don't try to fix them in place.

## What's NEXT — Stitch redesign

Stitch MCP added to local config (`claude mcp list` confirms it's connected). Tools become available after Claude Code restart.

When resumed, do this:

1. Confirm Stitch tools are available (they should appear as `mcp__stitch__*` in your tool list).
2. Brief Stitch with the design intent:
   - Multi-guide engineering docs hub
   - Audience: Osama + colleagues (working reference, NOT marketing landing)
   - Senior aesthetic, simple, focused, with restrained animations
   - Should feel like a CONTINUATION of osamahassouna.com Variant D (dark editorial magazine, Fraunces + amber) BUT toned down for long-form reading
   - Light AND dark mode both need to look intentional
   - Code blocks must be clearly separated visually (the previous "always-dark code in light mode" approach can stay if it looks right)
3. Generate 2-3 design directions via Stitch.
4. Show Osama the options.
5. Once a direction is picked, replace `src/styles/theme.css` + `src/styles/motion.css` with the new system.
6. Use Playwright MCP (already connected) to take before/after screenshots and verify both light + dark modes.

## Content state — DO NOT TOUCH unless asked

22 pages exist. Sidebar config in `astro.config.mjs`.

**Polished content (keep):**
- `/` Landing (`src/content/docs/index.mdx`)
- `/email-playbook/` Overview
- `/email-playbook/getting-started/`
- `/email-playbook/structure/head/` (full port from email-docx with grammar polish)
- `/email-playbook/production/gmail-clipping/` (NEW content, not in original)
- `/email-playbook/production/dark-mode/` (NEW)
- `/email-playbook/production/preheader/` (NEW)
- `/email-playbook/production/bulletproof-buttons/` (NEW)

**Stubbed (marked "porting in progress" — port later):**
- structure/{body-container, header, body, footer}
- components/{spacing, images, background-images, buttons, text}
- compatibility/{outlook, rtl, responsive}
- templates

Content is solid. The redesign is purely visual/CSS, not structural.

## What NOT to do

- **Don't migrate off Starlight.** It's the right tool. Replace the theme, not the framework.
- **Don't restore the old theme.css.** Osama rejected it.
- **Don't proactively port the 13 stubs.** Visual direction first, content later.
- **Don't push to GitHub yet.** Wait until the design is approved.
- **Don't touch DNS / Vercel** until design is final.

## Quick resume commands

```powershell
# Start dev server
cd D:/Personal/my-website/docs-hub
npm run dev

# Build to verify no errors
npm run build

# After redesign — verify with Playwright
# (use mcp__playwright__* tools to navigate + screenshot both themes)
```

## Cross-references

- Project memory: `C:/Users/OsamaHassouna/.claude/projects/D--Personal-EA-Demo/memory/project_docs_hub.md`
- Decision log entry: `D:/Personal/EA-Demo/decisions/log.md` (2026-05-21)
- Related: portfolio Variant D (`memory/project_portfolio_update.md`) — visual family reference
