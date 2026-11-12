import { descriptions, type TargetField } from "../src/mapping/fields";
import {
  resolveHeaders,
  clearsThreshold,
  checkConflicts,
  type Candidate,
} from "../src/mapping/resolve";
export interface Env {
  OPENAI_API_KEY?: string;
  EMBEDDING_AUTO_ACCEPT?: string;
}
const MODEL = "text-embedding-3-small";
const DIMENSIONS = 512;
const MAX_BODY_BYTES = 32_768;
const targets = Object.keys(descriptions) as TargetField[];
export function cosine(a: number[], b: number[]) {
  if (a.length !== b.length || !a.length)
    throw Error("Invalid embedding dimensions");
  let dot = 0,
    aa = 0,
    bb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}
function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
// Cache canonical descriptions only, never uploaded headers or API keys.
export function createEmbeddingHandler(fetcher: typeof fetch = fetch) {
  let fieldVectors: number[][] | undefined;
  let inflight = 0;
  const limits = new Map<string, { count: number; until: number }>();
  async function embed(texts: string[], key: string) {
    const response = await fetcher("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: MODEL,
        input: texts,
        dimensions: DIMENSIONS,
        encoding_format: "float",
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      throw Error(
        response.status === 429
          ? "Embedding service is busy; retry later."
          : "Embedding service unavailable. Check server configuration.",
      );
    const payload = (await response.json()) as {
      data?: { index: number; embedding: number[] }[];
    };
    if (!Array.isArray(payload.data) || payload.data.length !== texts.length)
      throw Error("Invalid embedding response");
    const vectors = Array<number[]>(texts.length);
    for (const item of payload.data) {
      if (
        !Number.isInteger(item.index) ||
        item.index < 0 ||
        item.index >= texts.length ||
        vectors[item.index] ||
        !Array.isArray(item.embedding) ||
        item.embedding.length !== DIMENSIONS ||
        !item.embedding.every(
          (n) => typeof n === "number" && Number.isFinite(n),
        )
      )
        throw Error("Invalid embedding response");
      vectors[item.index] = item.embedding;
    }
    return vectors;
  }
  return async function handle(
    request: Request,
    env: Env,
    local = false,
  ): Promise<Response> {
    if (request.method !== "POST")
      return json({ error: "Method not allowed" }, 405);
    const origin = request.headers.get("Origin");
    if (origin && origin !== new URL(request.url).origin)
      return json({ error: "Cross-origin requests are not allowed" }, 403);
    const identity = local
      ? "local"
      : request.headers.get("oai-authenticated-user-id");
    if (!identity && !local)
      return json({ error: "Authentication required" }, 401);
    if (
      !request.headers
        .get("content-type")
        ?.toLowerCase()
        .startsWith("application/json")
    )
      return json({ error: "JSON required" }, 415);
    let body: unknown;
    try {
      const reader = request.body?.getReader();
      if (!reader) return json({ error: "Request body required" }, 400);
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BODY_BYTES) {
          await reader.cancel();
          return json({ error: "Request too large" }, 413);
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      body = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).some((k) => k !== "headers") ||
      !("headers" in body) ||
      !Array.isArray(body.headers) ||
      body.headers.length < 1 ||
      body.headers.length > 100 ||
      !body.headers.every((h) => typeof h === "string" && h.length <= 160)
    )
      return json(
        { error: "Supply 1–100 header strings, each up to 160 characters." },
        400,
      );
    const decisions = resolveHeaders(body.headers as string[]);
    const unresolved = decisions.filter(
      (d) =>
        d.status === "unresolved" && d.normalized.replace(/\s/g, "").length > 3,
    );
    if (!unresolved.length) return json({ decisions, model: MODEL });
    if (!env.OPENAI_API_KEY || env.OPENAI_API_KEY === "replace-with-your-key")
      return json(
        {
          error:
            "Cloud matching is not configured. Set OPENAI_API_KEY on the server, or map these columns manually.",
        },
        503,
      );
    const now = Date.now();
    for (const [id, limit] of limits) if (limit.until <= now) limits.delete(id);
    const id = identity || "local";
    const limit = limits.get(id) || { count: 0, until: now + 60000 };
    if (
      limit.count >= 10 ||
      inflight >= 4 ||
      (limits.size >= 1000 && !limits.has(id))
    )
      return json(
        { error: "Too many matching requests. Retry shortly or map manually." },
        429,
      );
    limit.count++;
    limits.set(id, limit);
    inflight++;
    try {
      const unique = [...new Set(unresolved.map((d) => d.normalized))];
      const prefix = fieldVectors ? [] : targets.map((f) => descriptions[f]);
      const vectors = await embed([...prefix, ...unique], env.OPENAI_API_KEY);
      const canonical = fieldVectors ?? vectors.slice(0, targets.length);
      fieldVectors = canonical;
      const headerVectors = vectors.slice(prefix.length);
      const updates = new Map(
        unique.map((header, i) => [
          header,
          targets
            .map((field, j): Candidate => ({
              field,
              score: cosine(headerVectors[i], canonical[j]),
              method: "embedding",
            }))
            .sort((a, b) => b.score - a.score),
        ]),
      );
      const updated = decisions.map((d) => {
        const candidates = updates.get(d.normalized);
        if (d.status !== "unresolved" || !candidates) return d;
        const accepted =
          env.EMBEDDING_AUTO_ACCEPT === "true" &&
          clearsThreshold(candidates, 0.65, 0.08);
        return {
          ...d,
          candidates: candidates.slice(0, 3),
          method: "embedding" as const,
          status: accepted ? ("accepted" as const) : ("unresolved" as const),
          field: accepted ? candidates[0].field : null,
          reason: accepted
            ? "Experimental semantic thresholds passed; verify this mapping."
            : "Semantic suggestions only. Select a field or ignore; automatic acceptance is disabled or the match is ambiguous.",
        };
      });
      return json({ decisions: checkConflicts(updated), model: MODEL });
    } catch (error) {
      return json(
        {
          error:
            error instanceof Error &&
            error.message.startsWith("Embedding service")
              ? error.message
              : "Cloud matching failed or timed out. Map manually or retry.",
        },
        502,
      );
    } finally {
      inflight--;
    }
  };
}
export const handleEmbeddings = createEmbeddingHandler();
