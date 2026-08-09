import type { CmsAdapter, PublishInput, PublishResult } from "../types";

// WordPress REST API with an application password. This adapter creates
// DRAFTS only — a human reviews and publishes in wp-admin. (Ghost, by
// contrast, publishes live; pick the behavior you want per CMS.)

interface WordPressPost {
  id: number;
  slug: string;
  link: string;
}

export function createWordPressAdapter(options: {
  url: string;
  username: string;
  applicationPassword: string;
}): CmsAdapter {
  const { url, username, applicationPassword } = options;
  const auth = `Basic ${Buffer.from(`${username}:${applicationPassword}`).toString("base64")}`;

  const headers: Record<string, string> = {
    Authorization: auth,
    "Content-Type": "application/json",
  };

  const apiUrl = (path: string): string =>
    `${url}/wp-json/wp/v2${path}`;

  return {
    name: "wordpress",

    async findBySlug(slug: string): Promise<PublishResult | null> {
      // context=edit so drafts match too, not just published posts.
      const response = await fetch(
        apiUrl(`/posts?slug=${encodeURIComponent(slug)}&status=any&context=edit`),
        { headers },
      );
      if (!response.ok) {
        throw new Error(
          `WordPress lookup failed: ${response.status} ${await response.text()}`,
        );
      }
      const posts = (await response.json()) as WordPressPost[];
      const post = posts[0];
      return post ? { id: String(post.id), url: post.link } : null;
    },

    async publish(input: PublishInput): Promise<PublishResult> {
      const response = await fetch(apiUrl("/posts"), {
        method: "POST",
        headers,
        body: JSON.stringify({
          title: input.article.title,
          slug: input.slug,
          content: input.html,
          excerpt: input.article.excerpt,
          status: "draft",
        }),
      });

      if (!response.ok) {
        throw new Error(
          `WordPress draft creation failed: ${response.status} ${await response.text()}`,
        );
      }
      const post = (await response.json()) as WordPressPost;
      return { id: String(post.id), url: post.link };
    },

    async unpublish(id: string): Promise<void> {
      // Any status works here; "draft" pulls it off the site but keeps it
      // for review. (Use "trash" instead if unpublish should mean delete.)
      const response = await fetch(apiUrl(`/posts/${id}`), {
        method: "POST",
        headers,
        body: JSON.stringify({ status: "draft" }),
      });
      if (!response.ok) {
        throw new Error(
          `WordPress unpublish failed: ${response.status} ${await response.text()}`,
        );
      }
    },
  };
}
