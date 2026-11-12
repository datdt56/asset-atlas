import type { Asset } from "./extract";
import { fields, type Field } from "./asset-fields";
import { ignoredHeaders, aliases } from "./mapping/fields";
import { normalizeHeader } from "./mapping/resolve";
import { normalizeMemory, normalizeScreen } from "./parse";
import {
  AiRequest,
  AiInputRow,
  AI_SELECTION_LIMIT,
  AI_BATCH_SIZE,
  validateAiResult,
  type InputRow,
  type Suggestion,
} from "./ai-schema";

export function defaultAiColumns(columns: string[]): string[] {
  const excluded = [...ignoredHeaders, ...aliases.serial].map(normalizeHeader);
  return columns.filter(
    (column) =>
      !excluded.includes(normalizeHeader(column.replace(/ \[\d+\]$/, ""))),
  );
}

export async function analyzeRows(
  rows: InputRow[],
  signal: AbortSignal,
  onBatch: (rows: Suggestion[], model: string) => void,
  fetcher: typeof fetch = fetch,
) {
  // Deduplicate identical selected cells within this action, including across sheets.
  const groups = new Map<string, InputRow[]>();
  for (const row of rows) {
    const key = JSON.stringify(
      Object.entries(row.cells).sort(([a], [b]) => a.localeCompare(b)),
    );
    groups.set(key, [...(groups.get(key) || []), row]);
  }
  if (
    !rows.length ||
    rows.length > AI_SELECTION_LIMIT ||
    new Set(rows.map((row) => row.id)).size !== rows.length
  ) {
    throw Error("Choose 1–100 rows with unique IDs.");
  }
  const unique = [...groups.values()];
  const requests: { rows: InputRow[] }[] = [];
  let batch: InputRow[] = [];
  for (const group of unique) {
    const row = group[0];
    if (!AiInputRow.safeParse(row).success) {
      throw Error(
        "Each row needs 1–50 selected nonempty cells, up to 2,000 characters per cell. Adjust the column selection.",
      );
    }
    if (
      batch.length &&
      (batch.length === AI_BATCH_SIZE ||
        JSON.stringify({ rows: [...batch, row] }).length > 32000)
    ) {
      requests.push(AiRequest.parse({ rows: batch }));
      batch = [];
    }
    batch.push(row);
  }
  if (batch.length) {
    const parsed = AiRequest.safeParse({ rows: batch });
    if (!parsed.success)
      throw Error(
        "Selected input exceeds the request size limit. Choose fewer columns.",
      );
    requests.push(parsed.data);
  }
  // Validate every batch before any paid request. Never silently truncate input.
  for (const request of requests) {
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    const response = await fetcher("/api/ai-extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal,
    });
    const payload = await response.json();
    if (!response.ok)
      throw Error(
        payload.error ||
          "AI assistance is unavailable. Your local results are unchanged.",
      );
    const result = validateAiResult(payload.result, request.rows);
    const expanded = result.rows.flatMap((suggestion) => {
      const group = unique.find((items) => items[0].id === suggestion.id)!;
      return group.map((row) => ({ ...suggestion, id: row.id }));
    });
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    onBatch(
      expanded,
      typeof payload.model === "string" ? payload.model : "Configured model",
    );
  }
}

export function buildAiEdits(
  asset: Asset,
  current: Partial<Asset>,
  suggestion: Suggestion,
  chosen: Field[],
): Partial<Asset> {
  if (suggestion.id !== asset.id)
    throw Error("Suggestion does not match this asset.");
  const next = { ...current };
  const applied: Field[] = [];
  for (const field of fields) {
    if (!chosen.includes(field) || current[field] !== undefined) continue;
    const proposal = suggestion.fields[field];
    if (!proposal) continue;
    next[field] =
      field === "ram"
        ? normalizeMemory(proposal.value)
        : field === "screen"
          ? normalizeScreen(proposal.value)
          : proposal.value;
    applied.push(field);
  }
  if (applied.length)
    next.inferred = asset.inferred.filter((field) => !applied.includes(field));
  return next;
}
