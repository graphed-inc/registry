import { createHmac } from "node:crypto";
import type { CmsAdapter, PublishInput, PublishResult } from "../types";

// Ghost Admin API auth is a short-lived HS256 JWT built from the
// id:secret admin key — no SDK needed.

function base64Url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function createGhostJwt(adminApiKey: string): string {
  const [keyId, secretHex] = adminApiKey.split(":");
  if (!keyId || !secretHex) {
    throw new Error(
      "GHOST_ADMIN_API_KEY must use the Ghost Admin API id:secret format.",
    );
  }

  const header = { alg: "HS256", typ: "JWT", kid: keyId };
  const now = Math.floor(Date.now() / 1000);
  const payload = { iat: now, exp: now + 300, aud: "/admin/" };
  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
  const signature = createHmac("sha256", Buffer.from(secretHex, "hex"))
    .update(unsigned)
    .digest();
  return `${unsigned}.${base64Url(signature)}`;
}

function adminHeaders(adminApiKey: string): Record<string, string> {
  return {
    Authorization: `Ghost ${createGhostJwt(adminApiKey)}`,
    "Accept-Version": "v6.0",
    "Content-Type": "application/json",
  };
}

interface GhostPost {
  id: string;
  slug: string;
  url: string;
}

export function createGhostAdapter(options: {
  apiUrl: string;
  adminApiKey: string;
}): CmsAdapter {
  const { apiUrl, adminApiKey } = options;

  return {
    name: "ghost",

    async findBySlug(slug: string): Promise<PublishResult | null> {
      const response = await fetch(
        `${apiUrl}/ghost/api/admin/posts/slug/${slug}/`,
        { headers: adminHeaders(adminApiKey) },
      );
      if (response.status === 404) return null;
      if (!response.ok) {
        throw new Error(
          `Ghost lookup failed: ${response.status} ${await response.text()}`,
        );
      }
      const body = (await response.json()) as { posts?: GhostPost[] };
      const post = body.posts?.[0];
      return post ? { id: post.id, url: post.url } : null;
    },

    async publish(input: PublishInput): Promise<PublishResult> {
      const url = new URL(`${apiUrl}/ghost/api/admin/posts/`);
      url.searchParams.set("source", "html");

      const response = await fetch(url, {
        method: "POST",
        headers: adminHeaders(adminApiKey),
        body: JSON.stringify({
          posts: [
            {
              title: input.article.title,
              slug: input.slug,
              html: input.html,
              // Ghost publishes live immediately. If you'd rather review in
              // Ghost first, change this to "draft".
              status: "published",
              meta_description: input.article.meta_description,
              custom_excerpt: input.article.excerpt,
            },
          ],
        }),
      });

      if (!response.ok) {
        throw new Error(
          `Ghost publish failed: ${response.status} ${await response.text()}`,
        );
      }
      const body = (await response.json()) as { posts?: GhostPost[] };
      const post = body.posts?.[0];
      if (!post) throw new Error("Ghost publish response had no post.");
      return { id: post.id, url: post.url };
    },

    async unpublish(id: string): Promise<void> {
      // Ghost reverts a post to draft via update; the update requires the
      // post's current updated_at as an optimistic-collision check.
      const getResponse = await fetch(
        `${apiUrl}/ghost/api/admin/posts/${id}/`,
        { headers: adminHeaders(adminApiKey) },
      );
      if (!getResponse.ok) {
        throw new Error(
          `Ghost fetch for unpublish failed: ${getResponse.status} ${await getResponse.text()}`,
        );
      }
      const body = (await getResponse.json()) as {
        posts?: { id: string; updated_at: string }[];
      };
      const post = body.posts?.[0];
      if (!post) throw new Error("Ghost post not found for unpublish.");

      const response = await fetch(
        `${apiUrl}/ghost/api/admin/posts/${id}/`,
        {
          method: "PUT",
          headers: adminHeaders(adminApiKey),
          body: JSON.stringify({
            posts: [{ status: "draft", updated_at: post.updated_at }],
          }),
        },
      );
      if (!response.ok) {
        throw new Error(
          `Ghost unpublish failed: ${response.status} ${await response.text()}`,
        );
      }
    },
  };
}
