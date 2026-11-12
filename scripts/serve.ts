import { createServer } from "node:http";
import { loadEnv } from "vite";
import { adaptRequest } from "../server/node-adapter";
import { handleAi } from "../server/ai";
const worker = (await import(/* @vite-ignore */ "../dist/server/index.js"))
  .default;
const env = { ...loadEnv("production", process.cwd(), ""), ...process.env };
createServer((req, res) => {
  void adaptRequest(req, res, (request) =>
    new URL(request.url).pathname === "/api/ai-extract"
      ? handleAi(request, env, true)
      : worker.fetch(request, env),
  );
}).listen(4173, "127.0.0.1", () =>
  console.log("Asset Atlas: http://127.0.0.1:4173"),
);
