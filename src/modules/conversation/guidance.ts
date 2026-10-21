/**
 * Deterministic retrieval over approved medication guidance. No embeddings,
 * no vector database: token overlap with the patient's medication names and
 * the current utterance. Results are grounding context for the LLM only —
 * never dosage advice and never a source of decisions.
 */

export interface GuidanceSnippet {
  medicationName: string;
  title: string;
  guidance: string;
  sourceLabel: string;
}

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "you",
  "your",
  "with",
  "that",
  "this",
  "have",
  "has",
  "had",
  "are",
  "was",
  "were",
  "from",
  "into",
  "about",
  "what",
  "when",
  "where",
  "which",
  "while",
  "will",
  "would",
  "could",
  "should",
  "there",
  "their",
  "them",
  "then",
  "than",
  "just",
  "like",
  "very",
  "also",
  "today",
  "feel",
  "feeling",
  "felt",
  "little",
  "bit",
  "really",
  "quite",
]);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

function sameStem(a: string, b: string): boolean {
  if (a === b) return true;
  let shared = 0;
  while (shared < a.length && shared < b.length && a[shared] === b[shared]) shared += 1;
  return shared >= 5;
}

function overlap(a: readonly string[], b: readonly string[]): number {
  return a.filter((token) => b.some((other) => sameStem(token, other))).length;
}

export function rankGuidance(
  rows: readonly GuidanceSnippet[],
  query: string,
  medicationNames: readonly string[],
  limit = 2,
): GuidanceSnippet[] {
  if (rows.length === 0) return [];
  const queryTokens = tokens(query);
  const medTokens = medicationNames.flatMap(tokens);
  const scored = rows.map((row) => {
    const textTokens = tokens(`${row.title} ${row.guidance}`);
    const nameTokens = tokens(row.medicationName);
    const nameMatch = medicationNames.some(
      (name) =>
        name.toLowerCase().includes(row.medicationName.toLowerCase()) ||
        row.medicationName.toLowerCase().includes(name.toLowerCase()),
    );
    const score =
      overlap(queryTokens, textTokens) * 2 +
      overlap(medTokens, nameTokens) +
      (nameMatch ? 1 : 0);
    return { row, score };
  });
  scored.sort((a, b) => b.score - a.score || a.row.title.localeCompare(b.row.title));
  return scored
    .filter((entry) => entry.score > 0)
    .slice(0, limit)
    .map((entry) => entry.row);
}
