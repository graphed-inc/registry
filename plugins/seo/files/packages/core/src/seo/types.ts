export interface GeneratedArticle {
  title: string;
  meta_description: string;
  excerpt: string;
  markdown: string;
}

export interface PublishInput {
  slug: string;
  article: GeneratedArticle;
  /** Article body rendered as HTML (see ../markdown). */
  html: string;
}

export interface PublishResult {
  /** CMS-assigned post id, stored in seo_articles.cms_post_id. */
  id: string;
  /** Public URL when the CMS publishes immediately; null for drafts. */
  url: string | null;
}

// One implementation per CMS. Ghost publishes live posts; the WordPress
// adapter creates drafts for human review (it never auto-publishes).
export interface CmsAdapter {
  readonly name: string;
  /** Returns the existing post id/url when the slug is already published. */
  findBySlug(slug: string): Promise<PublishResult | null>;
  publish(input: PublishInput): Promise<PublishResult>;
  /**
   * Reverts a published post to draft, where the CMS supports it
   * (Ghost, WordPress, and Strapi v5 with Draft & Publish all do).
   * When absent, unpublishing only resets local state — the live post
   * stays up and must be pulled down by hand.
   */
  unpublish?(id: string): Promise<void>;
}

export interface ClientConfig {
  client: {
    name: string;
    siteUrl: string;
    brandVoice: string;
    audience: string;
  };
  content: {
    defaultWordCount: number;
    ctaText?: string;
    ctaUrl?: string;
  };
  cms: {
    type: "ghost" | "wordpress" | "strapi" | "none";
    /**
     * Strapi only: the API collection plural name, e.g. "articles"
     * (requests go to /api/<collection>). Every Strapi instance defines its
     * own content types, so there is no default — inspect the instance's
     * schema to fill this in.
     */
    collection?: string;
    /**
     * Strapi only: the body field's storage format — "blocks" (Strapi v5
     * rich-text Blocks), "markdown", or "html" (CKEditor-style rich text).
     */
    bodyFormat?: "blocks" | "markdown" | "html";
    /**
     * Strapi only: map our article concepts onto the instance's attribute
     * names. Defaults: title, slug, excerpt, body, seoDescription.
     */
    fields?: {
      title?: string;
      slug?: string;
      excerpt?: string;
      body?: string;
      metaDescription?: string;
    };
    /**
     * Strapi is headless, so it has no canonical post URL. Optional pattern
     * for the frontend that renders the blog, e.g. "https://example.com/blog/{slug}".
     */
    publicUrlPattern?: string;
  };
  /**
   * Warehouse-backed metrics. `searchConsoleSchema` is the ClickHouse
   * database name of this client's Google Search Console source on Graphed
   * (e.g. "search_xsbvd7"). Every source of a type shares the same schema
   * shape — see metrics.ts for the table reference — so the schema name is
   * the only per-client value. The integrating agent discovers it with:
   *   graphed warehouse query -- "SHOW DATABASES"   →  the `search_*` entry
   * Omit it and the dashboard quietly hides the GSC cards.
   */
  metrics?: {
    searchConsoleSchema?: string;
  };
}
