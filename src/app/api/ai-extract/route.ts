import "server-only";
import { handleAi } from "../../../server/ai";
import { authenticate, passwordRequired } from "../../../server/auth";

export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  const user = authenticate(request, process.env);
  if (!user) {
    if (!process.env.APP_PASSWORD)
      return Response.json(
        {
          error:
            "Production AI requires APP_PASSWORD in the server environment. Local parsing remains available.",
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    return passwordRequired();
  }
  return handleAi(
    request,
    {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      LLM_MODEL: process.env.LLM_MODEL,
    },
    user,
  );
}
