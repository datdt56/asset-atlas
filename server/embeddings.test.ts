import { test } from "node:test";
import assert from "node:assert/strict";
import { createEmbeddingHandler, cosine } from "./embeddings";
const url = "https://assets.example/api/header-mapping";
const request = (headers: unknown, extra: Record<string, string> = {}) =>
  new Request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://assets.example",
      ...extra,
    },
    body: JSON.stringify({ headers }),
  });
const key = "test-only-placeholder";
function fakeProvider(
  calls: { input: string[]; model: string; dimensions: number }[],
) {
  return (async (_url, options) => {
    const payload = JSON.parse(options!.body as string);
    calls.push(payload);
    return Response.json({
      data: payload.input
        .map((_text: string, i: number) => ({
          index: i,
          embedding: Array.from({ length: 512 }, (_, j) =>
            j === (payload.input.length === 1 ? 5 : i < 9 ? i : 5) ? 1 : 0,
          ),
        }))
        .reverse(),
    });
  }) as typeof fetch;
}
test("cosine checks dimensions and handles zero vectors", () => {
  assert.equal(cosine([1, 0], [1, 0]), 1);
  assert.equal(cosine([0, 0], [1, 0]), 0);
  assert.throws(() => cosine([1], [1, 0]));
});
test("missing key falls back without a provider request; exact aliases skip embeddings", async () => {
  const handler = createEmbeddingHandler(async () => {
    throw Error("Must not call");
  });
  assert.equal(
    (await handler(request(["Physical memory installed"]), {}, true)).status,
    503,
  );
  const response = await handler(request(["Serial", "RAM"]), {}, true);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).decisions[0].field, "serial");
});
test("requires identity in hosted mode, same origin, bounded JSON header-only input", async () => {
  const handler = createEmbeddingHandler();
  assert.equal((await handler(request(["anything"]), {})).status, 401);
  assert.equal(
    (
      await handler(
        request(["anything"], { Origin: "https://evil.example" }),
        {},
        true,
      )
    ).status,
    403,
  );
  for (const input of [[], Array(101).fill("Header"), ["x".repeat(161)], [123]])
    assert.equal((await handler(request(input), {}, true)).status, 400);
  assert.equal(
    (
      await handler(
        new Request(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ headers: ["Header"], rows: ["private"] }),
        }),
        {},
        true,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await handler(
        new Request(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: " ".repeat(32769),
        }),
        {},
        true,
      )
    ).status,
    413,
  );
});
test("batches unresolved headers, orders provider indices, caches canonical vectors, and defaults to suggestions", async () => {
  const calls: { input: string[]; model: string; dimensions: number }[] = [];
  const handler = createEmbeddingHandler(fakeProvider(calls));
  const response = await handler(
    request([
      "Physical memory installed",
      "Serial",
      "Physical memory installed",
    ]),
    { OPENAI_API_KEY: key },
    true,
  );
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.decisions[0].status, "unresolved");
  assert.equal(data.decisions[0].candidates[0].field, "ram");
  assert.equal(data.decisions[1].field, "serial");
  assert.equal(calls[0].input.length, 10);
  assert(!calls[0].input.includes("Serial"));
  assert.equal(calls[0].model, "text-embedding-3-small");
  assert.equal(calls[0].dimensions, 512);
  assert(!JSON.stringify(data).includes(key));
  await handler(
    request(["Physical memory installed"]),
    { OPENAI_API_KEY: key },
    true,
  );
  assert.equal(calls[1].input.length, 1);
});
test("auto acceptance is explicit and singleton conflicts remain unresolved", async () => {
  const handler = createEmbeddingHandler(fakeProvider([]));
  const response = await handler(
    request(["Physical memory installed"]),
    { OPENAI_API_KEY: key, EMBEDDING_AUTO_ACCEPT: "true" },
    true,
  );
  assert.equal((await response.json()).decisions[0].field, "ram");
  const conflict = await handler(
    request(["RAM", "Physical memory installed"]),
    { OPENAI_API_KEY: key, EMBEDDING_AUTO_ACCEPT: "true" },
    true,
  );
  assert(
    (await conflict.json()).decisions.every(
      (d: { status: string }) => d.status === "unresolved",
    ),
  );
});
test("provider errors never leak key or upstream response body", async () => {
  const handler = createEmbeddingHandler(
    async () => new Response("private upstream " + key, { status: 401 }),
  );
  const response = await handler(
    request(["Physical memory installed"]),
    { OPENAI_API_KEY: key },
    true,
  );
  assert.equal(response.status, 502);
  assert(!(await response.text()).includes(key));
});
test("bounds per-user request count", async () => {
  const handler = createEmbeddingHandler(fakeProvider([]));
  for (let i = 0; i < 10; i++)
    assert.equal(
      (
        await handler(
          request(["Physical memory installed"]),
          { OPENAI_API_KEY: key },
          true,
        )
      ).status,
      200,
    );
  assert.equal(
    (
      await handler(
        request(["Physical memory installed"]),
        { OPENAI_API_KEY: key },
        true,
      )
    ).status,
    429,
  );
});

test("rejects malformed provider vectors and handles network failures without disclosure", async () => {
  for (const fetcher of [
    async () => Response.json({ data: [{ index: 0, embedding: [1] }] }),
    async () => {
      throw Error("Network failure with confidential detail");
    },
  ]) {
    const handler = createEmbeddingHandler(fetcher as typeof fetch);
    const response = await handler(
      request(["Physical memory installed"]),
      { OPENAI_API_KEY: key },
      true,
    );
    assert.equal(response.status, 502);
    assert(!(await response.text()).includes("confidential"));
  }
});
