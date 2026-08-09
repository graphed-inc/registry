import { getDb } from "../db/index";

// Playbooks: the user-editable instructions each pipeline stage follows.
// Defaults live here; rows in seo_playbooks override them (edited from the
// dashboard's Playbook card). Keep defaults tight — they're injected into
// every prompt, so every token is paid for on every run.

export const PLAYBOOK_STAGES = [
  { key: "research", label: "Research" },
  { key: "outline", label: "Outline" },
  { key: "draft", label: "Draft" },
  { key: "edit", label: "Edit" },
  { key: "factcheck", label: "Fact-check" },
] as const;

export type PlaybookStage = (typeof PLAYBOOK_STAGES)[number]["key"];

export const DEFAULT_PLAYBOOKS: Record<PlaybookStage, string> = {
  research: `Used to interpret the SERP material, not to generate it.
- Treat the top organic results as the bar: their titles and snippets show the angle Google rewards for this query.
- People-also-ask questions are section candidates.
- Note every statistic, date, price, or named product you see — the fact-check stage will only allow claims traceable to this material.`,
  outline: `- 5-8 H2 sections. The first section must directly answer the core query before any background or context.
- If the keyword implies comparison ("best", "vs", "alternatives"), include exactly one comparison or list section.
- Never outline an "introduction" or "conclusion" section — the first H2 starts the substance.
- Points under each section are claims the draft must make; make them specific, not "discuss X".`,
  draft: `- Follow the outline exactly; do not add or drop sections.
- Write for skimmers: short paragraphs, concrete numbers over adjectives, lists where the outline has parallel points.
- First sentence of every section must say something a skim reader values — no "When it comes to X, ..." openers.`,
  edit: `- Cut 15-25% of the words. Delete filler, keep claims.
- Kill formulaic phrases: "in today's world", "it's important to note", "look no further", "game-changer".
- Every sentence must survive the "so what" test for the target audience — if a section doesn't help them decide or do something, rewrite it until it does.`,
  factcheck: `- Only statistics, dates, prices, rankings, and named-product capabilities count as factual claims — opinions and general advice do not.
- A claim passes if it is traceable to the research material. Anything else: soften it to general language ("many users report", "pricing varies") or delete it.
- Never add citations, footnotes, or links. Never silently change the meaning — list every change you make in corrections.`,
};

export type Playbooks = Record<PlaybookStage, string>;

function isStage(value: string): value is PlaybookStage {
  return PLAYBOOK_STAGES.some((stage) => stage.key === value);
}

/** DB overrides layered on the code defaults. Missing table → defaults. */
export async function loadPlaybooks(): Promise<Playbooks> {
  let rows: { stage: string; content: string }[] = [];
  try {
    rows = await getDb()
      .selectFrom("seo_playbooks")
      .select(["stage", "content"])
      .execute();
  } catch {
    // Migration not applied yet — defaults are fine, the dashboard's
    // "tables not found" card tells the user what to run.
  }
  const overrides = new Map(rows.map((row) => [row.stage, row.content]));
  return Object.fromEntries(
    PLAYBOOK_STAGES.map((stage) => [
      stage.key,
      overrides.get(stage.key) ?? DEFAULT_PLAYBOOKS[stage.key],
    ]),
  ) as Playbooks;
}

/** Which stages have a DB override (drives the dashboard's reset button). */
export async function loadPlaybookOverrides(): Promise<Set<string>> {
  try {
    const rows = await getDb()
      .selectFrom("seo_playbooks")
      .select("stage")
      .execute();
    return new Set(rows.map((row) => row.stage));
  } catch {
    return new Set();
  }
}

export async function savePlaybook(
  stage: string,
  content: string,
): Promise<void> {
  if (!isStage(stage)) throw new Error(`Unknown playbook stage: ${stage}`);
  if (!content.trim()) throw new Error("Playbook content cannot be empty.");
  await getDb()
    .insertInto("seo_playbooks")
    .values({ stage, content, updated_at: new Date() })
    .onConflict((oc) =>
      oc.column("stage").doUpdateSet({ content, updated_at: new Date() }),
    )
    .execute();
}

/** Back to the code default: the override row is simply deleted. */
export async function resetPlaybook(stage: string): Promise<void> {
  if (!isStage(stage)) throw new Error(`Unknown playbook stage: ${stage}`);
  await getDb()
    .deleteFrom("seo_playbooks")
    .where("stage", "=", stage)
    .execute();
}
