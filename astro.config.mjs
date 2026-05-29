// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import vercel from '@astrojs/vercel';

export default defineConfig({
	site: 'https://docs.osamahassouna.com',
	adapter: vercel(),
	// The /api/mcp JSON-RPC endpoint must accept POSTs from any origin / any
	// Content-Type (MCP clients vary). Site has no traditional forms — Astro's
	// CSRF check would only block legit MCP traffic that forgets to set
	// Content-Type: application/json.
	security: { checkOrigin: false },
	integrations: [
		starlight({
			title: 'Osama Hassouna',
			description: 'Engineering notes and practical guides by Osama Hassouna.',
			defaultLocale: 'en',
			social: [
				{ icon: 'github', label: 'GitHub', href: 'https://github.com/OsamaHassouna' },
			],
			head: [
				{
					tag: 'script',
					content: `
						(function () {
							try {
								var stored = localStorage.getItem('starlight-theme');
								if (!stored) {
									localStorage.setItem('starlight-theme', 'light');
								}
								if (!stored || stored === 'auto') {
									document.documentElement.dataset.theme = 'light';
									document.documentElement.style.colorScheme = 'light';
								}
							} catch (e) {}
						})();
					`,
				},
				{
					tag: 'script',
					attrs: { defer: true, src: '/_vercel/insights/script.js' },
				},
				// Default social-card image. Per-page frontmatter can override
				// via Starlight's `head` block if a page wants its own image.
				{
					tag: 'meta',
					attrs: { property: 'og:image', content: 'https://docs.osamahassouna.com/og-default.png' },
				},
				{
					tag: 'meta',
					attrs: { property: 'og:image:width', content: '1200' },
				},
				{
					tag: 'meta',
					attrs: { property: 'og:image:height', content: '630' },
				},
				{
					tag: 'meta',
					attrs: { property: 'og:image:alt', content: 'HTML Email Playbook — MCP server + CLI that teaches AI to write email that renders in Outlook and Gmail' },
				},
				{
					tag: 'meta',
					attrs: { name: 'twitter:card', content: 'summary_large_image' },
				},
				{
					tag: 'meta',
					attrs: { name: 'twitter:image', content: 'https://docs.osamahassouna.com/og-default.png' },
				},
			],
			customCss: [
				'./src/styles/fonts.css',
				'./src/styles/theme.css',
				'./src/styles/motion.css',
			],
			expressiveCode: {
				themes: ['github-dark-default'],
				styleOverrides: {
					borderRadius: '4px',
					borderColor: '#2A2724',
					codeFontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
					codeFontSize: '0.9rem',
					codeLineHeight: '1.6',
					codeBackground: '#16140F',
					frames: {
						editorBackground: '#16140F',
						editorActiveTabBackground: '#16140F',
						editorActiveTabIndicatorBottomColor: '#E68A2E',
						editorTabBarBackground: '#0E0D0B',
						editorTabsMarginInlineStart: '0',
						terminalBackground: '#16140F',
						terminalTitlebarBackground: '#0E0D0B',
						terminalTitlebarBorderBottomColor: '#1A1815',
						shadowColor: 'transparent',
					},
				},
			},
			pagination: true,
			lastUpdated: false,
			tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 3 },
			sidebar: [
				{
					label: 'HTML Email Playbook',
					items: [
						{ label: 'Overview', slug: 'email-playbook' },
						{ label: 'Getting Started', slug: 'email-playbook/getting-started' },
						{
							label: 'Structure',
							items: [
								{ label: 'Head', slug: 'email-playbook/structure/head' },
								{ label: 'Body Container', slug: 'email-playbook/structure/body-container' },
								{ label: 'Header', slug: 'email-playbook/structure/header' },
								{ label: 'Body', slug: 'email-playbook/structure/body' },
								{ label: 'Footer', slug: 'email-playbook/structure/footer' },
							],
						},
						{
							label: 'Components',
							items: [
								{ label: 'Spacing', slug: 'email-playbook/components/spacing' },
								{ label: 'Images', slug: 'email-playbook/components/images' },
								{ label: 'Inline Icons', slug: 'email-playbook/components/inline-icon' },
								{ label: 'Background Images (VML)', slug: 'email-playbook/components/background-images' },
								{ label: 'Buttons', slug: 'email-playbook/components/buttons' },
								{ label: 'Text', slug: 'email-playbook/components/text' },
							],
						},
						{
							label: 'Compatibility',
							items: [
								{ label: 'Outlook & MSO', slug: 'email-playbook/compatibility/outlook' },
								{ label: 'RTL Support', slug: 'email-playbook/compatibility/rtl' },
								{ label: 'Responsive', slug: 'email-playbook/compatibility/responsive' },
							],
						},
						{
							label: 'Production',
							items: [
								{ label: 'Gmail 102KB Clipping', slug: 'email-playbook/production/gmail-clipping' },
								{ label: 'Dark Mode', slug: 'email-playbook/production/dark-mode' },
								{ label: 'Preheader Text', slug: 'email-playbook/production/preheader' },
								{ label: 'Bulletproof Buttons', slug: 'email-playbook/production/bulletproof-buttons' },
							],
						},
						{
							label: 'AI Generation',
							items: [
								{ label: 'Absolute Rules', slug: 'email-playbook/ai-generation/absolute-rules' },
								{ label: 'Asset Policy', slug: 'email-playbook/ai-generation/asset-policy' },
								{ label: 'Content Fidelity', slug: 'email-playbook/ai-generation/content-fidelity' },
								{ label: 'Image Placeholders', slug: 'email-playbook/ai-generation/image-placeholders' },
								{ label: 'Link Tokens', slug: 'email-playbook/ai-generation/link-tokens' },
								{ label: 'Output Format', slug: 'email-playbook/ai-generation/output-format' },
								{ label: 'Handoff Checklist', slug: 'email-playbook/ai-generation/handoff-checklist' },
							],
						},
						{ label: 'Templates', slug: 'email-playbook/templates' },
						{ label: 'Playground', slug: 'email-playbook/playground' },
						{ label: 'MCP', slug: 'email-playbook/cli' },
						{ label: 'Builder', slug: 'email-playbook/builder' },
					],
				},
			],
		}),
	],
});
