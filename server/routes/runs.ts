import { Router } from "express";
import type { Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db.js";
import { runs, runResults } from "../schema.js";
import { initSSE, sendSSE } from "../sse.js";
import { executeRun } from "../run-executor.js";

const router = Router();

// Map of runId -> set of SSE response streams
const sseClients = new Map<string, Set<Response>>();

export function notifyRunProgress(runId: string, event: string, data: any) {
  const clients = sseClients.get(runId);
  if (!clients) return;
  for (const res of clients) {
    sendSSE(res, event, data);
  }
}

// POST /api/runs — create a run and start background execution
router.post("/runs", async (req, res) => {
  try {
    const { suiteId, label } = req.body;
    if (!suiteId) {
      return res.status(400).json({ error: "suiteId is required" });
    }

    const [run] = await db
      .insert(runs)
      .values({ suiteId, label: label ?? null, status: "running" })
      .returning();

    // Start execution in background (do not await)
    executeRun(run.id).catch((err) => {
      console.error(`Run ${run.id} failed:`, err);
    });

    return res.status(201).json(run);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/runs?suite_id=... — list runs for a suite
router.get("/runs", async (req, res) => {
  try {
    const { suite_id } = req.query;
    if (!suite_id) {
      return res.status(400).json({ error: "suite_id query param is required" });
    }

    const rows = await db
      .select()
      .from(runs)
      .where(eq(runs.suiteId, suite_id as string))
      .orderBy(runs.startedAt);
    return res.json(rows);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/runs/:id — return run with its results
router.get("/runs/:id", async (req, res) => {
  try {
    const [run] = await db
      .select()
      .from(runs)
      .where(eq(runs.id, req.params.id));
    if (!run) return res.status(404).json({ error: "Run not found" });

    const results = await db
      .select()
      .from(runResults)
      .where(eq(runResults.runId, req.params.id))
      .orderBy(runResults.createdAt);

    return res.json({ ...run, results });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/runs/:id/results/:resultId — single result
router.get("/runs/:id/results/:resultId", async (req, res) => {
  try {
    const [result] = await db
      .select()
      .from(runResults)
      .where(eq(runResults.id, req.params.resultId));
    if (!result) return res.status(404).json({ error: "Result not found" });
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// PUT /api/runs/:id — update run label
router.put("/runs/:id", async (req, res) => {
  try {
    const { label } = req.body;
    const [updated] = await db
      .update(runs)
      .set({ label: label ?? null })
      .where(eq(runs.id, req.params.id))
      .returning();
    if (!updated) return res.status(404).json({ error: "Run not found" });
    return res.json(updated);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/runs/:id/stream — SSE stream for run progress
router.get("/runs/:id/stream", (req, res) => {
  const runId = req.params.id;
  initSSE(res);

  if (!sseClients.has(runId)) {
    sseClients.set(runId, new Set());
  }
  sseClients.get(runId)!.add(res);

  // Clean up on disconnect
  req.on("close", () => {
    const clients = sseClients.get(runId);
    if (clients) {
      clients.delete(res);
      if (clients.size === 0) sseClients.delete(runId);
    }
  });
});

export default router;
