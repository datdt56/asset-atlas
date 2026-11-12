import { normalizeHeader, type HeaderDecision } from "./resolve";
const cache = new Map<string, HeaderDecision[]>();
export async function matchCloud(
  headers: string[],
  signal: AbortSignal,
): Promise<HeaderDecision[]> {
  const key = JSON.stringify(headers.map(normalizeHeader));
  const existing = cache.get(key);
  if (existing) return existing.map((d, i) => ({ ...d, original: headers[i] }));
  const response = await fetch("/api/header-mapping", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ headers }),
    signal,
  });
  const result = await response.json();
  if (!response.ok)
    throw Error(
      result.error || "Cloud matching unavailable. Map columns manually.",
    );
  if (
    !Array.isArray(result.decisions) ||
    result.decisions.length !== headers.length
  )
    throw Error("Invalid mapping response");
  if (cache.size >= 100) cache.delete(cache.keys().next().value!);
  cache.set(key, result.decisions);
  return result.decisions;
}
