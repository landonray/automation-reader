import { eq } from "drizzle-orm";
import { db } from "./db.js";
import { runs, testSuites, testCases, runResults, llmCalls, accounts } from "./schema.js";
import { runPipeline } from "./reader/pipeline.js";
import { ontraportHeaders } from "./ontraport.js";
import { notifyRunProgress } from "./routes/runs.js";

export async function executeRun(runId: string): Promise<void> {
  // 1. Look up the run
  const [run] = await db.select().from(runs).where(eq(runs.id, runId));
  if (!run) throw new Error(`Run ${runId} not found`);

  // 2. Look up the suite and account
  const [suite] = await db
    .select()
    .from(testSuites)
    .where(eq(testSuites.id, run.suiteId));
  if (!suite) throw new Error(`Suite ${run.suiteId} not found`);

  const [account] = await db
    .select()
    .from(accounts)
    .where(eq(accounts.id, suite.accountId));
  if (!account) throw new Error(`Account ${suite.accountId} not found`);

  // 3. Get all test cases for the suite
  const cases = await db
    .select()
    .from(testCases)
    .where(eq(testCases.suiteId, suite.id))
    .orderBy(testCases.capturedAt);

  if (cases.length === 0) {
    await db
      .update(runs)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(runs.id, runId));
    notifyRunProgress(runId, "completed", { runId, total: 0 });
    return;
  }

  // 4. Create pending result rows for all test cases
  const pendingResults = await db
    .insert(runResults)
    .values(
      cases.map((tc) => ({
        runId,
        testCaseId: tc.id,
        status: "pending",
      })),
    )
    .returning();

  // Map testCaseId -> result row
  const resultByTestCase = new Map(
    pendingResults.map((r) => [r.testCaseId, r]),
  );

  const headers = ontraportHeaders({ appId: account.appId, apiKey: account.apiKey });
  const total = cases.length;

  notifyRunProgress(runId, "started", { runId, total });

  // 5. Process each test case sequentially
  for (let i = 0; i < cases.length; i++) {
    const tc = cases[i];
    const result = resultByTestCase.get(tc.id);
    if (!result) continue;

    notifyRunProgress(runId, "progress", {
      runId,
      index: i,
      total,
      testCaseId: tc.id,
      automationName: tc.automationName,
      status: "running",
    });

    try {
      const pipelineResult = await runPipeline({
        automationJson: tc.rawJson,
        ontraportHeaders: headers,
      });

      // 6. Update result row with pipeline output
      await db
        .update(runResults)
        .set({
          status: "completed",
          intent: pipelineResult.layers.intent,
          behavioralSummary: pipelineResult.layers.behavioral_summary,
          nodeDetails: pipelineResult.chunks as any,
          chunkCount: pipelineResult.stats.chunkCount,
          narratorLlmCalls: pipelineResult.stats.narratorLlmCalls,
          narratorDeterministicCalls: pipelineResult.stats.narratorDeterministicCalls,
          synthesizerLlmCalls: pipelineResult.stats.synthesizerLlmCalls,
          timing: pipelineResult.timing as any,
          validation: pipelineResult.validation as any,
          enrichmentCache: pipelineResult.enrichmentCache as any,
          chunks: pipelineResult.chunks as any,
        })
        .where(eq(runResults.id, result.id));

      // 7. Log LLM call records
      if (pipelineResult.llmCallRecords.length > 0) {
        await db.insert(llmCalls).values(
          pipelineResult.llmCallRecords.map((record) => ({
            runResultId: result.id,
            stage: record.stage,
            chunkId: record.chunkId,
            systemPrompt: record.systemPrompt,
            userPrompt: record.userPrompt,
            response: record.response,
            finishReason: record.finishReason,
            promptTokens: record.promptTokens ?? null,
            completionTokens: record.completionTokens ?? null,
            latencyMs: record.latencyMs,
            wasRetry: record.wasRetry,
          })),
        );
      }

      notifyRunProgress(runId, "progress", {
        runId,
        index: i,
        total,
        testCaseId: tc.id,
        automationName: tc.automationName,
        status: "completed",
        resultId: result.id,
      });
    } catch (err: any) {
      // Mark this result as failed but continue with remaining test cases
      await db
        .update(runResults)
        .set({
          status: "failed",
          errorMessage: err.message ?? "Unknown error",
        })
        .where(eq(runResults.id, result.id));

      notifyRunProgress(runId, "progress", {
        runId,
        index: i,
        total,
        testCaseId: tc.id,
        automationName: tc.automationName,
        status: "failed",
        error: err.message,
      });
    }
  }

  // 8. Mark run as completed
  await db
    .update(runs)
    .set({ status: "completed", completedAt: new Date() })
    .where(eq(runs.id, runId));

  notifyRunProgress(runId, "completed", { runId, total });
}
