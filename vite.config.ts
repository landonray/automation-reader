import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
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
    proxy: {
      "/api": "http://localhost:5000",
    },
  },
});
