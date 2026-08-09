"use server";

import { redirect } from "next/navigation";
import {
  deleteKeyword,
  importKeywordsCsv,
  unpublishArticle,
} from "@app/core/seo/manage";
import { runSeoPipeline } from "@app/core/seo/pipeline";
import {
  savePlaybook,
  resetPlaybook,
  loadPlaybooks,
  PLAYBOOK_STAGES,
  type Playbooks,
} from "@app/core/seo/playbooks";
import { loadSeoConfig } from "@app/core/seo/config";
import {
  generateArticle,
  type GenerationEvent,
} from "@app/core/seo/generate";
import type { GeneratedArticle } from "@app/core/seo/types";

// Server actions for the SEO console. Each mutates via @app/core, then
// redirects back to /seo with a ?notice=/?error= banner param. The page is
// force-dynamic, so the redirect alone re-renders fresh data.
//
// Note: redirect() works by throwing a NEXT_REDIRECT "error" — never call it
// inside try/catch, or the catch swallows the navigation.

function back(params: Record<string, string>): never {
  redirect(`/seo?${new URLSearchParams(params).toString()}`);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Manually run the pipeline for one queued (or failed) keyword. */
export async function runKeywordAction(formData: FormData): Promise<void> {
  const keywordId = Number(formData.get("keywordId"));
  let params: Record<string, string>;
  try {
    const result = await runSeoPipeline({ keywordId });
    params = {
      notice: `"${result.keyword}" ${result.status}${result.publicUrl ? ` — ${result.publicUrl}` : ""}`,
    };
  } catch (error) {
    params = { error: messageOf(error) };
  }
  back(params);
}

/** Revert a published article to draft (in the CMS when supported). */
export async function unpublishAction(formData: FormData): Promise<void> {
  const articleId = Number(formData.get("articleId"));
  let params: Record<string, string>;
  try {
    const { note } = await unpublishArticle(articleId);
    params = { notice: note };
  } catch (error) {
    params = { error: messageOf(error) };
  }
  back(params);
}

/** Remove a keyword (and its articles) from the queue. Local only. */
export async function deleteKeywordAction(formData: FormData): Promise<void> {
  const keywordId = Number(formData.get("keywordId"));
  await deleteKeyword(keywordId);
  back({ notice: "Keyword removed from the queue." });
}

// Playbook save/reset return state instead of redirecting: the studio holds
// unsaved edits for every stage client-side, and a redirect would wipe them.
export interface PlaybookSaveState {
  status: "idle" | "ok" | "error";
  message?: string;
  stage?: string;
  // Lets the client tell repeated identical saves apart.
  nonce?: number;
}

/** Save one playbook stage's instructions (persisted override). */
export async function savePlaybookAction(
  _prev: PlaybookSaveState,
  formData: FormData,
): Promise<PlaybookSaveState> {
  const stage = String(formData.get("stage") ?? "");
  const content = String(formData.get("content") ?? "");
  try {
    await savePlaybook(stage, content);
    return {
      status: "ok",
      stage,
      nonce: Date.now(),
      message: `Saved "${stage}" — the live job uses it on its next run.`,
    };
  } catch (error) {
    return { status: "error", stage, nonce: Date.now(), message: messageOf(error) };
  }
}

/** Drop a stage's DB override — back to the code default. */
export async function resetPlaybookAction(
  _prev: PlaybookSaveState,
  formData: FormData,
): Promise<PlaybookSaveState> {
  const stage = String(formData.get("stage") ?? "");
  try {
    await resetPlaybook(stage);
    return {
      status: "ok",
      stage,
      nonce: Date.now(),
      message: `"${stage}" reset to the default.`,
    };
  } catch (error) {
    return { status: "error", stage, nonce: Date.now(), message: messageOf(error) };
  }
}

export interface TestRunState {
  status: "idle" | "done" | "error";
  error?: string;
  article?: GeneratedArticle;
  events?: GenerationEvent[];
}

/**
 * Test console: run the full generation pipeline for an ad-hoc keyword.
 * Deliberately side-effect-free — no queue row, no article row, no CMS
 * writes — so users can iterate on playbooks against real output. Used
 * with useFormState from the client (the article is far too large for a
 * redirect URL).
 *
 * The client sends every stage's current editor contents as pb_<stage>
 * fields, so UNSAVED edits are what get tested — the persisted playbooks
 * the live cron job reads are never touched. Fields missing/blank (older
 * client, hand-rolled POST) fall back to the persisted playbooks.
 */
export async function testKeywordAction(
  _prev: TestRunState,
  formData: FormData,
): Promise<TestRunState> {
  const keyword = String(formData.get("keyword") ?? "").trim();
  if (!keyword) return { status: "error", error: "Enter a keyword." };

  const wire = Object.fromEntries(
    PLAYBOOK_STAGES.map((stage) => [
      stage.key,
      String(formData.get(`pb_${stage.key}`) ?? ""),
    ]),
  ) as Playbooks;
  const playbooks = PLAYBOOK_STAGES.every((stage) => wire[stage.key].trim())
    ? wire
    : await loadPlaybooks();

  try {
    const config = loadSeoConfig();
    const events: GenerationEvent[] = [];
    const article = await generateArticle({
      keyword,
      config: config.client,
      apiKey: config.openRouterApiKey,
      model: config.openRouterModel,
      serperApiKey: config.serperApiKey,
      exaApiKey: config.exaApiKey,
      playbooks,
      onEvent: (event) => events.push(event),
    });
    return { status: "done", article, events };
  } catch (error) {
    return { status: "error", error: messageOf(error) };
  }
}

/** Import keywords from pasted CSV: `keyword[, slug[, priority]]` per line. */
export async function importKeywordsAction(formData: FormData): Promise<void> {
  const csv = String(formData.get("csv") ?? "");
  if (!csv.trim()) {
    back({ error: "Paste at least one keyword to import." });
  }
  let params: Record<string, string>;
  try {
    const { imported, skipped } = await importKeywordsCsv(csv);
    params = {
      notice: `Imported ${imported} keyword${imported === 1 ? "" : "s"}${skipped ? ` (${skipped} skipped as duplicates/invalid)` : ""}.`,
    };
  } catch (error) {
    params = { error: messageOf(error) };
  }
  back(params);
}
