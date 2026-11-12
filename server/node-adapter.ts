import type { IncomingMessage, ServerResponse } from "node:http";
export async function adaptRequest(
  req: IncomingMessage,
  res: ServerResponse,
  handler: (r: Request) => Promise<Response>,
) {
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 32768) {
        res.writeHead(413, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Request too large" }));
        return;
      }
      chunks.push(Buffer.from(chunk));
    }
    const host = req.headers.host || "localhost";
    const request = new Request(`http://${host}${req.url}`, {
      method: req.method,
      headers: new Headers(
        Object.entries(req.headers).flatMap(([k, v]) =>
          v === undefined
            ? []
            : [[k, Array.isArray(v) ? v.join(",") : v] as [string, string]],
        ),
      ),
      ...(!["GET", "HEAD"].includes(req.method || "GET")
        ? { body: Buffer.concat(chunks) }
        : {}),
    });
    const response = await handler(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Request failed" }));
  }
}
