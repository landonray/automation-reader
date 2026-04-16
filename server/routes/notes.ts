import { Router } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db.js";
import { notes } from "../schema.js";

const router = Router();

// GET /api/notes?run_result_id=...
router.get("/notes", async (req, res) => {
  try {
    const { run_result_id } = req.query;
    if (!run_result_id) {
      return res.status(400).json({ error: "run_result_id query param is required" });
    }

    const rows = await db
      .select()
      .from(notes)
      .where(eq(notes.runResultId, run_result_id as string))
      .orderBy(notes.createdAt);
    return res.json(rows);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/notes
router.post("/notes", async (req, res) => {
  try {
    const { runResultId, content, layer } = req.body;
    if (!runResultId || !content) {
      return res.status(400).json({ error: "runResultId and content are required" });
    }

    const [note] = await db
      .insert(notes)
      .values({ runResultId, content, layer: layer ?? null })
      .returning();
    return res.status(201).json(note);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// PUT /api/notes/:id
router.put("/notes/:id", async (req, res) => {
  try {
    const { content } = req.body;
    if (!content) {
      return res.status(400).json({ error: "content is required" });
    }

    const [updated] = await db
      .update(notes)
      .set({ content, updatedAt: new Date() })
      .where(eq(notes.id, req.params.id))
      .returning();
    if (!updated) return res.status(404).json({ error: "Note not found" });
    return res.json(updated);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /api/notes/:id
router.delete("/notes/:id", async (req, res) => {
  try {
    await db.delete(notes).where(eq(notes.id, req.params.id));
    return res.status(204).send();
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
