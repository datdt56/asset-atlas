import type { IncomingMessage, ServerResponse } from "node:http";
export async function adaptRequest(
  req: IncomingMessage,
  res: ServerResponse,
  handler: (request: Request) => Promise<Response>,
) {
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 65536) {
        res.writeHead(413, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Request too large." }));
        return;
      }
      chunks.push(Buffer.from(chunk));
    }
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value !== undefined)
        headers.set(key, Array.isArray(value) ? value.join(",") : value);
    }
    const cancellation = new AbortController();
    res.on("close", () => cancellation.abort());
    const response = await handler(
      new Request(`http://${req.headers.host || "localhost"}${req.url}`, {
        method: req.method,
        signal: cancellation.signal,
        headers,
        ...(!["GET", "HEAD"].includes(req.method || "GET")
          ? { body: Buffer.concat(chunks) }
          : {}),
      }),
    );
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Server request failed." }));
  }
}
