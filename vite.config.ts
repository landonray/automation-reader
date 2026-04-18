import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(__dirname), "");
  const vitePort = parseInt(env.VITE_PORT || "5175", 10);
  const apiPort = parseInt(env.PORT || "3002", 10);
  return {
    plugins: [react()],
    root: ".",
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./client"),
      },
    },
    build: {
      outDir: "dist/public",
      emptyOutDir: true,
    },
    server: {
      port: vitePort,
      strictPort: true,
      proxy: {
        "/api": `http://localhost:${apiPort}`,
      },
    },
  };
});
