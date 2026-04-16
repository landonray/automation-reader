import { pgTable, uuid, text, integer, jsonb, timestamp, boolean, uniqueIndex, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  appId: text("app_id").notNull(),
  apiKey: text("api_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const testSuites = pgTable("test_suites", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_test_suites_account").on(t.accountId),
]);

export const testCases = pgTable("test_cases", {
  id: uuid("id").primaryKey().defaultRandom(),
  suiteId: uuid("suite_id").notNull().references(() => testSuites.id, { onDelete: "cascade" }),
  automationId: text("automation_id").notNull(),
  automationName: text("automation_name").notNull(),
  nodeCount: integer("node_count").notNull(),
  rawJson: jsonb("raw_json").notNull(),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_test_cases_suite").on(t.suiteId),
  uniqueIndex("uq_test_cases_suite_automation").on(t.suiteId, t.automationId),
]);

export const runs = pgTable("runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  suiteId: uuid("suite_id").notNull().references(() => testSuites.id, { onDelete: "cascade" }),
  label: text("label"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  status: text("status").notNull().default("running"),
  pipelineVersion: text("pipeline_version"),
  promptHash: text("prompt_hash"),
}, (t) => [
  index("idx_runs_suite").on(t.suiteId),
  index("idx_runs_suite_started").on(t.suiteId, t.startedAt),
  check("chk_runs_status", sql`${t.status} IN ('running', 'completed', 'failed')`),
]);

export const runResults = pgTable("run_results", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
  testCaseId: uuid("test_case_id").notNull().references(() => testCases.id, { onDelete: "cascade" }),
  intent: text("intent"),
  behavioralSummary: text("behavioral_summary"),
  nodeDetails: jsonb("node_details"),
  chunkCount: integer("chunk_count"),
  narratorLlmCalls: integer("narrator_llm_calls"),
  narratorDeterministicCalls: integer("narrator_deterministic_calls"),
  synthesizerLlmCalls: integer("synthesizer_llm_calls"),
  timing: jsonb("timing"),
  validation: jsonb("validation"),
  enrichmentCache: jsonb("enrichment_cache"),
  chunks: jsonb("chunks"),
  status: text("status").notNull().default("pending"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_run_results_run").on(t.runId),
  index("idx_run_results_test_case").on(t.testCaseId),
  check("chk_run_results_status", sql`${t.status} IN ('pending', 'running', 'completed', 'failed')`),
]);

export const notes = pgTable("notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  runResultId: uuid("run_result_id").notNull().references(() => runResults.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  layer: text("layer"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_notes_result").on(t.runResultId),
  check("chk_notes_layer", sql`${t.layer} IN ('intent', 'behavioral_summary', 'node_details') OR ${t.layer} IS NULL`),
]);

export const prompts = pgTable("prompts", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  currentVersionId: uuid("current_version_id"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const promptVersions = pgTable("prompt_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  promptId: uuid("prompt_id").notNull().references(() => prompts.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  content: text("content").notNull(),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_prompt_versions_prompt").on(t.promptId),
  uniqueIndex("uq_prompt_versions_prompt_version").on(t.promptId, t.version),
]);

export const llmCalls = pgTable("llm_calls", {
  id: uuid("id").primaryKey().defaultRandom(),
  runResultId: uuid("run_result_id").notNull().references(() => runResults.id, { onDelete: "cascade" }),
  stage: text("stage").notNull(),
  chunkId: text("chunk_id"),
  systemPrompt: text("system_prompt").notNull(),
  userPrompt: text("user_prompt").notNull(),
  response: text("response").notNull(),
  finishReason: text("finish_reason"),
  promptTokens: integer("prompt_tokens"),
  completionTokens: integer("completion_tokens"),
  latencyMs: integer("latency_ms"),
  wasRetry: boolean("was_retry").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_llm_calls_result").on(t.runResultId),
  index("idx_llm_calls_stage").on(t.runResultId, t.stage),
  check("chk_llm_calls_stage", sql`${t.stage} IN ('narrator', 'synthesizer', 'classifier')`),
]);
