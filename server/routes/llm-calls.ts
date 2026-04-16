import { Router } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db.js";
import { llmCalls } from "../schema.js";

const router = Router();

// GET /api/runs/:runId/results/:resultId/llm-calls
router.get("/runs/:runId/results/:resultId/llm-calls", async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(llmCalls)
      .where(eq(llmCalls.runResultId, req.params.resultId))
      .orderBy(llmCalls.createdAt);
    return res.json(rows);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
