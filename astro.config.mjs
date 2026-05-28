// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import vercel from '@astrojs/vercel';

export default defineConfig({
	site: 'https://docs.osamahassouna.com',
	adapter: vercel(),
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
						{ label: 'Templates', slug: 'email-playbook/templates' },
						{ label: 'Playground', slug: 'email-playbook/playground' },
						{ label: 'Builder', slug: 'email-playbook/builder' },
					],
				},
			],
		}),
	],
});
