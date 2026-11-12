import type { Mapping } from "../extract";
import { aliases, type TargetField } from "./fields";
export type MatchMethod = "exact" | "fuzzy" | "embedding" | "manual";
export interface Candidate {
  field: TargetField;
  score: number;
  method: MatchMethod;
}
export interface HeaderDecision {
  columnIndex: number;
  original: string;
  normalized: string;
  status: "accepted" | "unresolved" | "ignored";
  field: TargetField | null;
  method: MatchMethod | null;
  candidates: Candidate[];
  reason: string;
}
export const FUZZY_THRESHOLD = 0.88;
export const FUZZY_MARGIN = 0.1;
export function normalizeHeader(raw: string): string {
  return raw
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}
// Optimal string alignment distance supports adjacent transpositions.
export function similarity(a: string, b: string): number {
  if (!a || !b) return a === b ? 1 : 0;
  const d = Array.from({ length: a.length + 1 }, () =>
    Array<number>(b.length + 1).fill(0),
  );
  for (let i = 0; i <= a.length; i++) d[i][0] = i;
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return 1 - d[a.length][b.length] / Math.max(a.length, b.length);
}
const entries = Object.entries(aliases).map(([field, names]) => ({
  field: field as TargetField,
  names: names.map(normalizeHeader),
}));
export function clearsThreshold(
  candidates: Candidate[],
  threshold: number,
  margin: number,
) {
  return (
    candidates.length > 0 &&
    candidates[0].score >= threshold &&
    candidates[0].score - (candidates[1]?.score ?? 0) >= margin
  );
}
export function resolveHeader(
  original: string,
  columnIndex = 0,
): HeaderDecision {
  const normalized = normalizeHeader(original);
  const base: HeaderDecision = {
    columnIndex,
    original,
    normalized,
    status: "unresolved",
    field: null,
    method: null,
    candidates: [],
    reason: "No reliable match. Choose a field or ignore this column.",
  };
  if (!normalized || normalized.length > 160)
    return {
      ...base,
      reason: "Blank or oversized header; select a mapping manually.",
    };
  const exact = entries.filter((e) => e.names.includes(normalized));
  if (exact.length === 1)
    return {
      ...base,
      status: "accepted",
      field: exact[0].field,
      method: "exact",
      candidates: [{ field: exact[0].field, score: 1, method: "exact" }],
      reason: "Normalized header matches a known alias.",
    };
  if (exact.length > 1)
    return { ...base, reason: "Alias matches more than one field." };
  if (normalized.replace(/\s/g, "").length <= 3)
    return {
      ...base,
      reason: "Short unknown acronym; manual mapping required.",
    };
  const candidates = entries
    .map((e) => ({
      field: e.field,
      score: Math.max(
        ...e.names
          .filter((n) => n.length > 3)
          .map((n) => similarity(normalized, n)),
      ),
      method: "fuzzy" as const,
    }))
    .sort((a, b) => b.score - a.score);
  return {
    ...base,
    candidates: candidates.slice(0, 3),
    ...(clearsThreshold(candidates, FUZZY_THRESHOLD, FUZZY_MARGIN)
      ? {
          status: "accepted" as const,
          field: candidates[0].field,
          method: "fuzzy" as const,
          reason: "Typo similarity and separation thresholds passed.",
        }
      : { reason: "Fuzzy match is weak or ambiguous." }),
  };
}
export function resolveHeaders(headers: string[]) {
  return checkConflicts(headers.map(resolveHeader));
}
export function checkConflicts(decisions: HeaderDecision[]): HeaderDecision[] {
  const counts = new Map<TargetField, number>();
  for (const d of decisions)
    if (d.status === "accepted" && d.field)
      counts.set(d.field, (counts.get(d.field) || 0) + 1);
  return decisions.map((d) =>
    d.status === "accepted" &&
    d.field &&
    !["description", "storage"].includes(d.field) &&
    (counts.get(d.field) || 0) > 1
      ? {
          ...d,
          status: "unresolved",
          field: null,
          reason: `Multiple columns map to ${d.field}; choose one or ignore the extra column.`,
        }
      : d,
  );
}
export function decisionsToMapping(decisions: HeaderDecision[]): Mapping {
  return Object.fromEntries(
    decisions.map((d) => [
      d.columnIndex,
      d.status === "accepted" && d.field ? d.field : "ignore",
    ]),
  );
}
export function mapHeaders(headers: string[]) {
  return decisionsToMapping(resolveHeaders(headers));
}
export function detect(header: string): Mapping[string] {
  const d = resolveHeader(header);
  return d.status === "accepted" && d.field ? d.field : "ignore";
}
export function applyEmbeddingResults(
  current: HeaderDecision[],
  results: HeaderDecision[],
) {
  return checkConflicts(
    current.map((d) => {
      if (d.status !== "unresolved" || d.method === "manual") return d;
      const result = results.find(
        (r) => r.columnIndex === d.columnIndex && r.original === d.original,
      );
      return result ?? d;
    }),
  );
}
