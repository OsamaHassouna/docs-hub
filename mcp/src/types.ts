/**
 * Canonical Email Playbook spec types.
 *
 * Source of truth for both the MCP server and the hosted /api/mcp endpoint.
 * Generated from MDX in src/content/docs/email-playbook/ via mcp/build/extract.mjs.
 */

export type CategorySlug = 'structure' | 'components' | 'compatibility' | 'production';

export interface Category {
  slug: CategorySlug;
  title: string;
  description: string;
  page_count: number;
}

export interface CodeBlock {
  language: string;
  title?: string;
  code: string;
}

export interface Rule {
  slug: string;
  category: CategorySlug;
  title: string;
  description: string;
  body_md: string;
  examples: CodeBlock[];
}

export type ComponentCategory = 'layout' | 'media' | 'interactive' | 'text';

export interface Component {
  slug: string;
  name: string;
  category: 'components';
  subcategory: ComponentCategory;
  title: string;
  description: string;
  body_md: string;
  html: string;
  slots: string[];
  requires_vml: boolean;
  responsive: boolean;
  examples: CodeBlock[];
}

export interface ComponentSummary {
  name: string;
  subcategory: ComponentCategory;
  requires_vml: boolean;
  responsive: boolean;
}

export interface PlaybookSpec {
  version: string;
  generated_at: string;
  source_url: string;
  categories: Category[];
  rules: Rule[];
  components: Component[];
}
