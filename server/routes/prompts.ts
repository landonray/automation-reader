import { Router } from "express";
import { eq, desc, sql } from "drizzle-orm";
import { db } from "../db.js";
import { prompts, promptVersions } from "../schema.js";
import {
  PROMPT_DEFAULTS,
  PROMPT_DEFAULTS_BY_KEY,
} from "../reader/prompt-defaults.js";
import {
  ensureAllSeeded,
  invalidatePromptCache,
} from "../reader/prompt-loader.js";

const router = Router();

// GET /api/prompts — list all prompts with their current version content
router.get("/prompts", async (_req, res) => {
  try {
    await ensureAllSeeded();

    const rows = await db.select().from(prompts);
    const result = await Promise.all(
      rows.map(async (row) => {
        let currentContent: string | null = null;
        let currentVersion: number | null = null;
        if (row.currentVersionId) {
          const [v] = await db
            .select()
            .from(promptVersions)
            .where(eq(promptVersions.id, row.currentVersionId))
            .limit(1);
          if (v) {
            currentContent = v.content;
            currentVersion = v.version;
          }
        }

        const [{ count: versionCount }] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(promptVersions)
          .where(eq(promptVersions.promptId, row.id));

        const def = PROMPT_DEFAULTS_BY_KEY[row.key];
        return {
          id: row.id,
          key: row.key,
          name: row.name,
          description: row.description,
          currentVersionId: row.currentVersionId,
          currentVersion,
          currentContent,
          defaultContent: def?.content ?? null,
          versionCount,
          updatedAt: row.updatedAt,
        };
      }),
    );

    // Sort by defaults order (so UI shows them in a predictable, logical order)
    const keyOrder = new Map(PROMPT_DEFAULTS.map((d, i) => [d.key, i]));
    result.sort((a, b) => (keyOrder.get(a.key) ?? 99) - (keyOrder.get(b.key) ?? 99));

    return res.json(result);
  } catch (err: any) {
    console.error("[prompts] list error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/prompts/:key/versions — list all versions (newest first) for a prompt
router.get("/prompts/:key/versions", async (req, res) => {
  try {
    await ensureAllSeeded();
    const [row] = await db
      .select()
      .from(prompts)
      .where(eq(prompts.key, req.params.key))
      .limit(1);
    if (!row) return res.status(404).json({ error: "Prompt not found" });

    const versions = await db
      .select()
      .from(promptVersions)
      .where(eq(promptVersions.promptId, row.id))
      .orderBy(desc(promptVersions.version));

    return res.json({
      prompt: {
        id: row.id,
        key: row.key,
        name: row.name,
        description: row.description,
        currentVersionId: row.currentVersionId,
      },
      versions: versions.map((v) => ({
        id: v.id,
        version: v.version,
        content: v.content,
        note: v.note,
        createdAt: v.createdAt,
        isCurrent: v.id === row.currentVersionId,
      })),
    });
  } catch (err: any) {
    console.error("[prompts] versions error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/prompts/:key/versions — save a new version and make it current
// body: { content: string, note?: string }
router.post("/prompts/:key/versions", async (req, res) => {
  try {
    const { content, note } = req.body;
    if (typeof content !== "string" || content.length === 0) {
      return res.status(400).json({ error: "content is required" });
    }

    await ensureAllSeeded();
    const [row] = await db
      .select()
      .from(prompts)
      .where(eq(prompts.key, req.params.key))
      .limit(1);
    if (!row) return res.status(404).json({ error: "Prompt not found" });

    // Guard against saving an identical duplicate
    if (row.currentVersionId) {
      const [cur] = await db
        .select()
        .from(promptVersions)
        .where(eq(promptVersions.id, row.currentVersionId))
        .limit(1);
      if (cur && cur.content === content) {
        return res.status(200).json({
          unchanged: true,
          version: { id: cur.id, version: cur.version, content: cur.content, note: cur.note, createdAt: cur.createdAt },
        });
      }
    }

    const [{ max }] = await db
      .select({ max: sql<number>`coalesce(max(${promptVersions.version}), 0)::int` })
      .from(promptVersions)
      .where(eq(promptVersions.promptId, row.id));
    const nextVersion = (max ?? 0) + 1;

    const [newVersion] = await db
      .insert(promptVersions)
      .values({
        promptId: row.id,
        version: nextVersion,
        content,
        note: typeof note === "string" && note.trim().length > 0 ? note.trim() : null,
      })
      .returning();

    await db
      .update(prompts)
      .set({ currentVersionId: newVersion.id, updatedAt: new Date() })
      .where(eq(prompts.id, row.id));

    invalidatePromptCache(row.key);
    // synth prompts depend on synthesis_rules, so clear the whole cache to be safe
    if (row.key === "synthesis_rules") invalidatePromptCache();

    return res.status(201).json({
      id: newVersion.id,
      version: newVersion.version,
      content: newVersion.content,
      note: newVersion.note,
      createdAt: newVersion.createdAt,
      isCurrent: true,
    });
  } catch (err: any) {
    console.error("[prompts] save error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/prompts/:key/restore/:versionId — make an existing historical version current
router.post("/prompts/:key/restore/:versionId", async (req, res) => {
  try {
    await ensureAllSeeded();
    const [row] = await db
      .select()
      .from(prompts)
      .where(eq(prompts.key, req.params.key))
      .limit(1);
    if (!row) return res.status(404).json({ error: "Prompt not found" });

    const [version] = await db
      .select()
      .from(promptVersions)
      .where(eq(promptVersions.id, req.params.versionId))
      .limit(1);
    if (!version || version.promptId !== row.id) {
      return res.status(404).json({ error: "Version not found for this prompt" });
    }

    await db
      .update(prompts)
      .set({ currentVersionId: version.id, updatedAt: new Date() })
      .where(eq(prompts.id, row.id));

    invalidatePromptCache(row.key);
    if (row.key === "synthesis_rules") invalidatePromptCache();

    return res.json({
      id: version.id,
      version: version.version,
      content: version.content,
      note: version.note,
      createdAt: version.createdAt,
      isCurrent: true,
    });
  } catch (err: any) {
    console.error("[prompts] restore error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/prompts/:key/reset — restore the hardcoded default from code as a new version
router.post("/prompts/:key/reset", async (req, res) => {
  try {
    const def = PROMPT_DEFAULTS_BY_KEY[req.params.key];
    if (!def) return res.status(404).json({ error: "Unknown prompt key" });

    await ensureAllSeeded();
    const [row] = await db
      .select()
      .from(prompts)
      .where(eq(prompts.key, req.params.key))
      .limit(1);
    if (!row) return res.status(404).json({ error: "Prompt not found" });

    const [{ max }] = await db
      .select({ max: sql<number>`coalesce(max(${promptVersions.version}), 0)::int` })
      .from(promptVersions)
      .where(eq(promptVersions.promptId, row.id));
    const nextVersion = (max ?? 0) + 1;

    const [newVersion] = await db
      .insert(promptVersions)
      .values({
        promptId: row.id,
        version: nextVersion,
        content: def.content,
        note: "Reset to code default",
      })
      .returning();

    await db
      .update(prompts)
      .set({ currentVersionId: newVersion.id, updatedAt: new Date() })
      .where(eq(prompts.id, row.id));

    invalidatePromptCache(row.key);
    if (row.key === "synthesis_rules") invalidatePromptCache();

    return res.json({
      id: newVersion.id,
      version: newVersion.version,
      content: newVersion.content,
      note: newVersion.note,
      createdAt: newVersion.createdAt,
      isCurrent: true,
    });
  } catch (err: any) {
    console.error("[prompts] reset error:", err);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
