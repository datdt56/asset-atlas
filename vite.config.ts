import { defineConfig, loadEnv } from "vite";
import { handleEmbeddings } from "./server/embeddings";
import { adaptRequest } from "./server/node-adapter";
export default defineConfig(({ mode }) => ({
  server: { host: "127.0.0.1" },
  plugins: [
    {
      name: "header-mapping-api",
      configureServer(server) {
        const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env };
        server.middlewares.use("/api/header-mapping", (req, res) => {
          void adaptRequest(req, res, (r) => handleEmbeddings(r, env, true));
        });
      },
    },
  ],
}));
