import { timingSafeEqual } from "node:crypto";
interface AuthEnv {
  NODE_ENV?: string;
  APP_PASSWORD?: string;
}

// Development is loopback-only. Production AI requires a configured private-app password.
export function authenticate(request: Request, env: AuthEnv): string | null {
  if (env.NODE_ENV === "development") return "local";
  if (!env.APP_PASSWORD) return null;
  const actual = Buffer.from(request.headers.get("Authorization") || "");
  const expected = Buffer.from(
    `Basic ${Buffer.from(`atlas:${env.APP_PASSWORD}`).toString("base64")}`,
  );
  return actual.length === expected.length && timingSafeEqual(actual, expected)
    ? "private-user"
    : null;
}
export function passwordRequired() {
  return new Response(
    "Sign in with username atlas and the configured app password.",
    {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Basic realm="Asset Atlas", charset="UTF-8"',
        "Cache-Control": "no-store",
      },
    },
  );
}
