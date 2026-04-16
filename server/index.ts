import express from "express";
import accountsRouter from "./routes/accounts.js";
import suitesRouter from "./routes/suites.js";
import runsRouter from "./routes/runs.js";
import notesRouter from "./routes/notes.js";
import llmCallsRouter from "./routes/llm-calls.js";

const app = express();
app.use(express.json({ limit: "50mb" }));

// Mount API routes
app.use("/api", accountsRouter);
app.use("/api", suitesRouter);
app.use("/api", runsRouter);
app.use("/api", notesRouter);
app.use("/api", llmCallsRouter);

const PORT = Number(process.env.PORT) || 5000;

if (process.env.NODE_ENV === "production") {
  // Serve static files from Vite build output
  const { default: path } = await import("path");
  const { fileURLToPath } = await import("url");
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const distPath = path.join(__dirname, "..", "dist", "public");
  const { default: serveStatic } = await import("serve-static");
  app.use(serveStatic(distPath));
  // Fallback to index.html for SPA routing
  app.get("*", (_req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
} else {
  // Development: use Vite dev server as middleware
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
