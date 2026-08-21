import { defineConfig } from "vite";

const orchestrator = process.env.ORCHESTRATOR_URL ?? "http://127.0.0.1:8787";

export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/health": orchestrator,
      "/v1": orchestrator,
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
  },
});
