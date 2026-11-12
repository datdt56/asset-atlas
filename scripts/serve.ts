import { createServer } from "node:http";
import { loadEnv } from "vite";
import { adaptRequest } from "../server/node-adapter";
import { handleEmbeddings } from "../server/embeddings";
const worker = (await import(/* @vite-ignore */ "../dist/server/index.js"))
  .default;
const env = { ...loadEnv("production", process.cwd(), ""), ...process.env };
const server = createServer((req, res) => {
  void adaptRequest(req, res, (r) =>
    new URL(r.url).pathname === "/api/header-mapping"
      ? handleEmbeddings(r, env, true)
      : worker.fetch(r, env),
  );
});
server.listen(4173, "127.0.0.1", () =>
  console.log("Asset Atlas: http://127.0.0.1:4173"),
);
