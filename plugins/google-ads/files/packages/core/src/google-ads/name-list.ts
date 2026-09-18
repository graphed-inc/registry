const MAX_TERM_TOKENS = 4;

// A delimited list is explicit, so a multi-word entry is a deliberate
// name — but a ≤4-word entry can still be an instruction the length cap
// misses. Those open with the verb; "Not Just Travel" does not.
const INSTRUCTION_MARKER = /^(do|don'?t|never|avoid|please)\b/i;

class NameListError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NameListError";
  }
}

function isNameShaped(row: string): boolean {
  const trimmed = row.trim();
  if (!trimmed) return false;
  if (INSTRUCTION_MARKER.test(trimmed)) return false;
  return trimmed.split(/\s+/).length <= MAX_TERM_TOKENS;
}

const warned = new Set<string>();

/** Hard fail — `blocked_terms` is one promote, not process boot. */
export function assertNameList(terms: string[], label: string): string[] {
  const instruction = terms.find((row) => INSTRUCTION_MARKER.test(row));
  if (instruction) {
    throw new NameListError(
      `${label} entry reads like an instruction, not a name: "${instruction}"`,
    );
  }
  const prose = terms.find((row) => row.split(/\s+/).length > MAX_TERM_TOKENS);
  if (prose) {
    throw new NameListError(
      `${label} entry is longer than ${MAX_TERM_TOKENS} words — each entry must be a name, not a sentence: "${prose}"`,
    );
  }
  return terms;
}

export type DroppedNameList = { label: string; entries: string[] };

export type NameListKeep = { kept: string[]; dropped: string[] };

/** Soft filter — config load must not take down the dashboard or daily job. */
export function keepNameShaped(terms: string[], label: string): NameListKeep {
  const cleaned = terms.map((row) => row.trim()).filter(Boolean);
  const kept = cleaned.filter((row) => isNameShaped(row));
  const dropped = cleaned.filter((row) => !isNameShaped(row));
  if (dropped.length) {
    const key = `${label}:${dropped.join("|")}`;
    if (!warned.has(key)) {
      warned.add(key);
      console.warn(`${label}: ignoring non-name entries: ${dropped.join(", ")}`);
    }
  }
  return { kept, dropped };
}

export function formatDroppedNameListNote(
  drops: DroppedNameList[],
): string | null {
  if (!drops.length) return null;
  const parts = drops.map(
    (row) =>
      `${row.label} (${row.entries.map((entry) => `"${entry}"`).join(", ")})`,
  );
  return `Config dropped non-name entries that cannot match a search term: ${parts.join("; ")}. promote_search_term still uses the LLM judge for those. Fix the list in client.config.json.`;
}

/** Appended so headlineOf() still reads the agent summary / failure reason. */
export function appendDroppedNameListNote(
  report: string,
  drops: DroppedNameList[],
): string {
  const note = formatDroppedNameListNote(drops);
  return note ? `${report}\n\n${note}` : report;
}
