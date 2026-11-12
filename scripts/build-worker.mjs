import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { build } from "esbuild";
const assets = {};
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".csv": "text/csv; charset=utf-8",
};
async function collect(directory, prefix = "") {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (item.name === "server") continue;
    const path = `${directory}/${item.name}`,
      url = `${prefix}/${item.name}`;
    if (item.isDirectory()) await collect(path, url);
    else
      assets[url] = {
        body: (await readFile(path)).toString("base64"),
        type:
          types[item.name.slice(item.name.lastIndexOf("."))] ||
          "application/octet-stream",
      };
  }
}
await collect("dist");
await mkdir("dist/server", { recursive: true });
await build({
  stdin: {
    contents: `import {handleAi} from './server/ai.ts';const assets=${JSON.stringify(assets)};export default {async fetch(request,env){const path=new URL(request.url).pathname;if(path==='/api/ai-extract')return handleAi(request,env);if(path.startsWith('/api/'))return new Response('Not found',{status:404});if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405});const asset=assets[path==='/'?'/index.html':path];if(!asset)return new Response('Not found',{status:404});return new Response(request.method==='HEAD'?null:Uint8Array.from(atob(asset.body),c=>c.charCodeAt(0)),{headers:{'Content-Type':asset.type,'X-Content-Type-Options':'nosniff','Cache-Control':path.startsWith('/assets/')?'public, max-age=31536000, immutable':'no-cache'}})}}`,
    resolveDir: process.cwd(),
    sourcefile: "worker.ts",
    loader: "ts",
  },
  outfile: "dist/server/index.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
});
await mkdir("dist/.openai", { recursive: true });
await writeFile(
  "dist/.openai/hosting.json",
  await readFile(".openai/hosting.json"),
);
