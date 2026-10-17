/**
 * Canonical Email Playbook spec types.
 *
 * Source of truth for both the MCP server and the hosted /api/mcp endpoint.
 * Generated from MDX in src/content/docs/email-playbook/ via mcp/build/extract.mjs.
 */

export type CategorySlug = 'structure' | 'components' | 'compatibility' | 'production' | 'ai-generation';

export interface Category {
  slug: CategorySlug;
  title: string;
  description: string;
  page_count: number;
}

/** A list_categories entry: the category plus the slug and title of each page. */
export interface CategoryListing extends Category {
  pages: { slug: string; title: string }[];
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
  /** The rules to follow, authored in the page frontmatter. */
  checklist: string[];
  body_md: string;
  examples: CodeBlock[];
}

/** A get_playbook_rules entry with format "checklist". */
export type RuleChecklist = Pick<Rule, 'slug' | 'title' | 'description' | 'checklist'>;

/** A get_rule result: examples only with include_examples (the body already has the code). */
export type RulePage = Omit<Rule, 'examples'> & { examples?: CodeBlock[] };

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
  title: string;
  description: string;
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
