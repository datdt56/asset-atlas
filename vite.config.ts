import { defineConfig, loadEnv } from "vite";
import { handleAi } from "./server/ai";
import { adaptRequest } from "./server/node-adapter";
export default defineConfig(({ mode }) => ({
  server: { host: "127.0.0.1" },
  plugins: [
    {
      name: "local-ai-api",
      configureServer(server) {
        const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env };
        server.middlewares.use("/api/ai-extract", (req, res) => {
          void adaptRequest(req, res, (request) =>
            handleAi(request, env, true),
          );
        });
      },
    },
  ],
}));
