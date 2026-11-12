import { test } from "node:test";
import assert from "node:assert/strict";
import { authenticate, passwordRequired } from "./auth";

const url = "https://assets.example/api/ai-extract";
const env = { NODE_ENV: "production", APP_PASSWORD: "test-only-password" };
const request = (password: string) =>
  new Request(url, {
    headers: {
      Authorization: `Basic ${Buffer.from(`atlas:${password}`).toString("base64")}`,
    },
  });

test("development works locally without credentials; production requires verified credentials", () => {
  assert.equal(
    authenticate(new Request(url), { NODE_ENV: "development" }),
    "local",
  );
  assert.equal(
    authenticate(new Request(url), { NODE_ENV: "production" }),
    null,
  );
  assert.equal(authenticate(new Request(url), env), null);
  assert.equal(authenticate(request("wrong"), env), null);
  assert.equal(authenticate(request(env.APP_PASSWORD), env), "private-user");
  assert.equal(
    authenticate(
      new Request(url, {
        headers: { "oai-authenticated-user-id": "spoofed" },
      }),
      env,
    ),
    null,
  );
});

test("authentication challenge is uncached and does not disclose credentials", async () => {
  const response = passwordRequired();
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.match(response.headers.get("WWW-Authenticate") || "", /^Basic /);
  assert(!(await response.text()).includes(env.APP_PASSWORD));
});
