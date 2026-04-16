import { eq } from "drizzle-orm";
import { db } from "../db.js";
import { prompts, promptVersions } from "../schema.js";
import { PROMPT_DEFAULTS, PROMPT_DEFAULTS_BY_KEY } from "./prompt-defaults.js";

// In-process cache to keep hot paths (narrator/synthesizer) from hitting the DB every call.
// Invalidated whenever a new version is saved or a prompt is reset.
interface CacheEntry {
  content: string;
  fetchedAt: number;
}
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 30_000; // prompts rarely change; 30s is plenty

export function invalidatePromptCache(key?: string) {
  if (key) cache.delete(key);
  else cache.clear();
}

// Ensures a prompts row + v1 version row exist for this key. Idempotent.
async function ensureSeeded(key: string): Promise<void> {
  const def = PROMPT_DEFAULTS_BY_KEY[key];
  if (!def) throw new Error(`Unknown prompt key: ${key}`);

  const existing = await db.select().from(prompts).where(eq(prompts.key, key)).limit(1);
  if (existing.length > 0) return;

  const [row] = await db
    .insert(prompts)
    .values({ key: def.key, name: def.name, description: def.description })
    .returning();

  const [version] = await db
    .insert(promptVersions)
    .values({
      promptId: row.id,
      version: 1,
      content: def.content,
      note: "Initial version (seeded from code default)",
    })
    .returning();

  await db.update(prompts).set({ currentVersionId: version.id }).where(eq(prompts.id, row.id));
}

// Seed every default prompt. Called lazily on first list/get.
export async function ensureAllSeeded(): Promise<void> {
  for (const def of PROMPT_DEFAULTS) {
    await ensureSeeded(def.key);
  }
}

// Get the currently active content for a prompt key.
// Falls back to the hardcoded default if anything goes wrong so LLM calls never break.
export async function getPromptContent(key: string): Promise<string> {
  const def = PROMPT_DEFAULTS_BY_KEY[key];
  if (!def) throw new Error(`Unknown prompt key: ${key}`);

  const cached = cache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.content;
  }

  try {
    await ensureSeeded(key);
    const [row] = await db.select().from(prompts).where(eq(prompts.key, key)).limit(1);
    if (!row?.currentVersionId) {
      return def.content;
    }
    const [version] = await db
      .select()
      .from(promptVersions)
      .where(eq(promptVersions.id, row.currentVersionId))
      .limit(1);
    const content = version?.content ?? def.content;
    cache.set(key, { content, fetchedAt: Date.now() });
    return content;
  } catch (err) {
    console.error(`[prompt-loader] Failed to load ${key}, using default:`, err);
    return def.content;
  }
}

// Convenience: resolve a prompt template that may contain {{synthesis_rules}}.
// Used by the synthesizer where three prompts reuse the shared rules block.
export async function getResolvedPrompt(key: string): Promise<string> {
  const content = await getPromptContent(key);
  if (!content.includes("{{synthesis_rules}}")) return content;
  const rules = await getPromptContent("synthesis_rules");
  return content.replace(/\{\{synthesis_rules\}\}/g, rules);
}
