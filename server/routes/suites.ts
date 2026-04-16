import { Router } from "express";
import { eq, desc, sql } from "drizzle-orm";
import { db } from "../db.js";
import { accounts, testSuites, testCases, runs } from "../schema.js";
import { fetchAutomationJson } from "../ontraport.js";

const router = Router();

// POST /api/suites — create a new test suite for an account
router.post("/suites", async (req, res) => {
  try {
    const { accountId, name } = req.body;
    if (!accountId || !name) {
      return res.status(400).json({ error: "accountId and name are required" });
    }

    const [account] = await db
      .select()
      .from(accounts)
      .where(eq(accounts.id, accountId));
    if (!account) return res.status(404).json({ error: "Account not found" });

    const [suite] = await db
      .insert(testSuites)
      .values({ accountId, name })
      .returning();
    return res.status(201).json(suite);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/suites?account_id=... — list suites for an account
router.get("/suites", async (req, res) => {
  try {
    const { account_id } = req.query;
    if (!account_id) {
      return res.status(400).json({ error: "account_id query param is required" });
    }

    const rows = await db
      .select()
      .from(testSuites)
      .where(eq(testSuites.accountId, account_id as string))
      .orderBy(testSuites.createdAt);

    const enriched = await Promise.all(
      rows.map(async (suite) => {
        const [countResult] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(testCases)
          .where(eq(testCases.suiteId, suite.id));

        const [latestRun] = await db
          .select({ startedAt: runs.startedAt, status: runs.status })
          .from(runs)
          .where(eq(runs.suiteId, suite.id))
          .orderBy(desc(runs.startedAt))
          .limit(1);

        return {
          ...suite,
          automationCount: countResult?.count ?? 0,
          lastRunDate: latestRun?.startedAt ?? null,
          lastRunStatus: latestRun?.status ?? null,
        };
      }),
    );
    return res.json(enriched);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/suites/:id — return suite with its test cases
router.get("/suites/:id", async (req, res) => {
  try {
    const [suite] = await db
      .select()
      .from(testSuites)
      .where(eq(testSuites.id, req.params.id));
    if (!suite) return res.status(404).json({ error: "Suite not found" });

    const cases = await db
      .select()
      .from(testCases)
      .where(eq(testCases.suiteId, req.params.id))
      .orderBy(testCases.capturedAt);

    return res.json({ ...suite, testCases: cases });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/suites/:id/test-cases — fetch automations and create test case records
router.post("/suites/:id/test-cases", async (req, res) => {
  try {
    const [suite] = await db
      .select()
      .from(testSuites)
      .where(eq(testSuites.id, req.params.id));
    if (!suite) return res.status(404).json({ error: "Suite not found" });

    const [account] = await db
      .select()
      .from(accounts)
      .where(eq(accounts.id, suite.accountId));
    if (!account) return res.status(404).json({ error: "Account not found" });

    const { automationIds } = req.body as { automationIds: Array<{ id: string; name: string; nodeCount?: number }> };
    if (!Array.isArray(automationIds) || automationIds.length === 0) {
      return res.status(400).json({ error: "automationIds array is required" });
    }

    const creds = { appId: account.appId, apiKey: account.apiKey };
    const created = [];

    for (const auto of automationIds) {
      const rawJson = await fetchAutomationJson(creds, auto.id);
      const [tc] = await db
        .insert(testCases)
        .values({
          suiteId: suite.id,
          automationId: auto.id,
          automationName: auto.name,
          nodeCount: auto.nodeCount ?? 0,
          rawJson,
        })
        .onConflictDoUpdate({
          target: [testCases.suiteId, testCases.automationId],
          set: {
            automationName: auto.name,
            nodeCount: auto.nodeCount ?? 0,
            rawJson,
            capturedAt: new Date(),
          },
        })
        .returning();
      created.push(tc);
    }

    return res.status(201).json(created);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /api/test-cases/:id — spec requires this at top-level, not nested under /suites
router.delete("/test-cases/:id", async (req, res) => {
  try {
    await db.delete(testCases).where(eq(testCases.id, req.params.id));
    return res.status(204).send();
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
