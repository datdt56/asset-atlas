import { ratio } from "fuzzball";
import { aliases, ignoredHeaders, type TargetField } from "./fields";

export interface Candidate {
  field: TargetField;
  score: number;
}
export interface HeaderDecision {
  columnIndex: number;
  original: string;
  status: "accepted" | "unresolved" | "ignored";
  field: TargetField | null;
  method: "exact" | "fuzzy" | "manual" | null;
  candidates: Candidate[];
  reason: string;
}

export function normalizeHeader(raw: string): string {
  return raw
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const entries = Object.entries(aliases).map(([field, names]) => ({
  field: field as TargetField,
  names: names.map(normalizeHeader),
}));

export function resolveHeader(
  original: string,
  columnIndex = 0,
): HeaderDecision {
  const header = normalizeHeader(original);
  const decision: HeaderDecision = {
    columnIndex,
    original,
    status: "unresolved",
    field: null,
    method: null,
    candidates: [],
    reason: "Choose a field or ignore this column.",
  };
  if (ignoredHeaders.includes(header)) {
    return {
      ...decision,
      status: "ignored",
      reason: "Administrative column; source values are retained.",
    };
  }
  if (!header || header.length > 160) return decision;
  const exact = entries.find((entry) => entry.names.includes(header));
  if (exact)
    return {
      ...decision,
      status: "accepted",
      field: exact.field,
      method: "exact",
      reason: "Matches a known header alias.",
    };
  // Short acronyms are too ambiguous for typo matching (CPU vs GPU, RAM vs ROM).
  if (header.replace(/\s/g, "").length <= 3) return decision;
  const candidates = entries
    .map((entry) => ({
      field: entry.field,
      score: Math.max(
        ...entry.names
          .filter((name) => name.length > 3)
          .map((name) => ratio(header, name, { full_process: false }) / 100),
      ),
    }))
    .sort((a, b) => b.score - a.score);
  const [best, next] = candidates;
  // Conservative starting thresholds, checked against typo and negative fixtures.
  const accepted = best.score >= 0.82 && best.score - next.score >= 0.1;
  return {
    ...decision,
    candidates: candidates.slice(0, 3),
    ...(accepted
      ? {
          status: "accepted",
          field: best.field,
          method: "fuzzy",
          reason: "Close spelling match with a clear lead over other fields.",
        }
      : { reason: "Unknown or ambiguous header; please check the mapping." }),
  };
}

export function resolveHeaders(headers: string[]): HeaderDecision[] {
  return checkConflicts(headers.map(resolveHeader));
}

export function checkConflicts(decisions: HeaderDecision[]): HeaderDecision[] {
  return decisions.map((decision) => {
    if (
      decision.status !== "accepted" ||
      !decision.field ||
      ["description", "storage"].includes(decision.field)
    )
      return decision;
    const duplicates = decisions.filter(
      (other) => other.status === "accepted" && other.field === decision.field,
    );
    return duplicates.length > 1
      ? {
          ...decision,
          status: "unresolved",
          field: null,
          reason: `Multiple columns map to ${decision.field}; choose one or ignore the extra column.`,
        }
      : decision;
  });
}
