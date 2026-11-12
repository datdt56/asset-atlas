import { test } from "node:test";
import assert from "node:assert/strict";
import { createAiHandler } from "./ai";
import { assetTypes, fields } from "../asset-fields";
const url = "https://assets.example/api/ai-extract";
const rows = [{ id: "row-1", cells: { Hardware: "16GB RAM / 512GB SSD" } }];
const key = "test-only-not-a-real-key";
const request = (
  body: unknown = { rows },
  headers: Record<string, string> = {},
) =>
  new Request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://assets.example",
      ...headers,
    },
    body: JSON.stringify(body),
  });
const output = () => ({
  rows: [
    {
      id: "row-1",
      fields: {
        ...Object.fromEntries(fields.map((field) => [field, null])),
        ram: { value: "16 GB", sourceColumn: "Hardware", quote: "16GB RAM" },
      },
    },
  ],
});
function response(data: unknown = output(), status = "completed") {
  return Response.json({
    id: "resp_test",
    object: "response",
    created_at: 0,
    model: "test-model",
    status,
    output: [
      {
        type: "message",
        id: "message_test",
        status: "completed",
        role: "assistant",
        content: [
          { type: "output_text", annotations: [], text: JSON.stringify(data) },
        ],
      },
    ],
    usage: { input_tokens: 50, output_tokens: 50, total_tokens: 100 },
  });
}

test("missing key returns an actionable fallback without contacting OpenAI", async () => {
  const handler = createAiHandler(async () => {
    throw Error("Must not call");
  });
  const result = await handler(request(), {}, "test-user");
  assert.equal(result.status, 503);
  assert((await result.json()).error.includes("OPENAI_API_KEY"));
});

test("requires a verified user identity, same origin, POST and bounded JSON", async () => {
  const handler = createAiHandler();
  assert.equal((await handler(request(), {})).status, 401);
  assert.equal(
    (
      await handler(
        request({}, { Origin: "https://evil.example" }),
        {},
        "test-user",
      )
    ).status,
    403,
  );
  assert.equal((await handler(new Request(url), {}, "test-user")).status, 405);
  assert.equal(
    (await handler(request({ rows: [] }), {}, "test-user")).status,
    400,
  );
  assert.equal(
    (await handler(request({ rows, other: "unexpected" }), {}, "test-user"))
      .status,
    400,
  );
  assert.equal(
    (
      await handler(
        new Request(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: " ".repeat(65537),
        }),
        {},
        "test-user",
      )
    ).status,
    413,
  );
});

test("origin checks use the public host behind Next.js and an HTTPS proxy", async () => {
  const handler = createAiHandler();
  const makeRequest = (origin: string) =>
    new Request("http://localhost:3000/api/ai-extract", {
      method: "POST",
      headers: {
        Host: "assets.example",
        "X-Forwarded-Proto": "https",
        Origin: origin,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ rows }),
    });
  assert.equal(
    (await handler(makeRequest("https://assets.example"), {}, "test-user"))
      .status,
    503,
  );
  assert.equal(
    (await handler(makeRequest("https://evil.example"), {}, "test-user"))
      .status,
    403,
  );
});

test("SDK sends strict structured output, bounded tokens, no storage and no retries", async () => {
  let count = 0;
  const handler = createAiHandler((async (_url, options) => {
    count++;
    const body = JSON.parse(options!.body as string);
    assert.equal(body.model, "gpt-6-luna");
    assert.equal(body.store, false);
    assert.equal(body.max_output_tokens, 8000);
    assert.equal(body.reasoning.effort, "none");
    assert.equal(body.text.format.type, "json_schema");
    assert.equal(body.text.format.strict, true);
    assert(body.input[0].content.includes("untrusted data"));
    assert(body.input[0].content.includes(JSON.stringify(assetTypes)));
    const fieldSchema =
      body.text.format.schema.properties.rows.items.properties.fields;
    assert.deepEqual(fieldSchema.required, [...fields]);
    assert.deepEqual(
      fieldSchema.properties.type.anyOf[0].properties.value.enum,
      [...assetTypes],
    );
    assert.deepEqual(JSON.parse(body.input[1].content), { rows });
    return response();
  }) as typeof fetch);
  const result = await handler(request(), { OPENAI_API_KEY: key }, "test-user");
  assert.equal(result.status, 200);
  assert.equal((await result.json()).result.rows[0].fields.ram.value, "16 GB");
  assert.equal(count, 1);
});

test("validates evidence and IDs even when the provider returns schema-shaped data", async () => {
  for (const data of [
    { rows: [{ ...output().rows[0], id: "wrong" }] },
    {
      rows: [
        {
          ...output().rows[0],
          fields: {
            ...output().rows[0].fields,
            ram: { value: "64 GB", sourceColumn: "Hardware", quote: "64GB" },
          },
        },
      ],
    },
    { rows: [] },
  ]) {
    const handler = createAiHandler(async () => response(data));
    assert.equal(
      (await handler(request(), { OPENAI_API_KEY: key }, "test-user")).status,
      502,
    );
  }
});

test("provider errors and incomplete/refused output preserve the local fallback without disclosing secrets", async () => {
  for (const mock of [
    async () => new Response("Upstream details " + key, { status: 429 }),
    async () => response(output(), "incomplete"),
    async () =>
      Response.json({
        id: "refusal",
        status: "completed",
        output: [
          {
            type: "message",
            role: "assistant",
            content: [{ type: "refusal", refusal: "Cannot comply" }],
          },
        ],
      }),
  ]) {
    let count = 0;
    const handler = createAiHandler((async () => {
      count++;
      return mock();
    }) as typeof fetch);
    const result = await handler(
      request(),
      { OPENAI_API_KEY: key },
      "test-user",
    );
    assert.equal(result.status, 502);
    assert(!(await result.text()).includes(key));
    assert.equal(count, 1);
  }
});

test("rate limits paid requests per identity", async () => {
  const handler = createAiHandler(async () => response());
  for (let i = 0; i < 10; i++)
    assert.equal(
      (await handler(request(), { OPENAI_API_KEY: key }, "test-user")).status,
      200,
    );
  assert.equal(
    (await handler(request(), { OPENAI_API_KEY: key }, "test-user")).status,
    429,
  );
});
