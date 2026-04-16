import { Router } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db.js";
import { accounts } from "../schema.js";
import {
  validateCredentials,
  listAutomations,
  fetchAutomationJson,
} from "../ontraport.js";

const router = Router();

// POST /api/accounts — validate credentials and create account
router.post("/accounts", async (req, res) => {
  try {
    const { name, appId, apiKey } = req.body;
    if (!name || !appId || !apiKey) {
      return res.status(400).json({ error: "name, appId, and apiKey are required" });
    }

    const valid = await validateCredentials({ appId, apiKey });
    if (!valid) {
      return res.status(401).json({ error: "Invalid Ontraport credentials" });
    }

    const [account] = await db.insert(accounts).values({ name, appId, apiKey }).returning();
    return res.status(201).json(account);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/accounts — list all accounts
router.get("/accounts", async (_req, res) => {
  try {
    const rows = await db.select().from(accounts).orderBy(accounts.createdAt);
    return res.json(rows);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /api/accounts/:id
router.delete("/accounts/:id", async (req, res) => {
  try {
    await db.delete(accounts).where(eq(accounts.id, req.params.id));
    return res.status(204).send();
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/accounts/:id/automations
router.get("/accounts/:id/automations", async (req, res) => {
  try {
    const [account] = await db
      .select()
      .from(accounts)
      .where(eq(accounts.id, req.params.id));
    if (!account) return res.status(404).json({ error: "Account not found" });

    const automations = await listAutomations({ appId: account.appId, apiKey: account.apiKey });
    return res.json(automations);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/accounts/:id/automations/:autoId
router.get("/accounts/:id/automations/:autoId", async (req, res) => {
  try {
    const [account] = await db
      .select()
      .from(accounts)
      .where(eq(accounts.id, req.params.id));
    if (!account) return res.status(404).json({ error: "Account not found" });

    const data = await fetchAutomationJson(
      { appId: account.appId, apiKey: account.apiKey },
      req.params.autoId,
    );
    return res.json(data);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
