import { chatCompletion } from "../llm.js";
import type {
  Chunk,
  Relationship,
  SemanticLayers,
  NodeDetailLayer,
  EnrichmentCache,
} from "./types.js";
import { runWithConcurrency } from "./concurrency.js";
import { getResolvedPrompt } from "./prompt-loader.js";

// ---------------------------------------------------------------------------
// LLM Call Record — captures timing and prompt details for each LLM call
// ---------------------------------------------------------------------------

export interface LlmCallRecord {
  stage: "narrator" | "synthesizer";
  chunkId: string;
  systemPrompt: string;
  userPrompt: string;
  response: string;
  finishReason: string;
  promptTokens?: number;
  completionTokens?: number;
  latencyMs: number;
  wasRetry: boolean;
}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface SynthesizeResult {
  layers: SemanticLayers;
  llmCalls: number;
  llmCallRecords: LlmCallRecord[];
}

// ---------------------------------------------------------------------------
// askLLMJson wrapper that captures call records
// ---------------------------------------------------------------------------

async function askLLMJsonWithRecord<T>(
  systemPrompt: string,
  userPrompt: string,
  options: { maxTokens?: number; temperature?: number },
  chunkId: string,
  records: LlmCallRecord[],
): Promise<T> {
  const start = Date.now();
  const resp = await chatCompletion({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    maxTokens: options.maxTokens || 4096,
    temperature: options.temperature ?? 0.3,
  });
  const latencyMs = Date.now() - start;

  records.push({
    stage: "synthesizer",
    chunkId,
    systemPrompt,
    userPrompt,
    response: resp.content,
    finishReason: resp.finish_reason,
    promptTokens: resp.usage?.prompt_tokens,
    completionTokens: resp.usage?.completion_tokens,
    latencyMs,
    wasRetry: false,
  });

  const text = resp.content.trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("LLM response did not contain valid JSON");
  }
  return JSON.parse(jsonMatch[0]) as T;
}

// Prompts are loaded from the database at runtime via prompt-loader.
// The editable keys are: synthesis_rules, synth_non_tiered, synth_tier1, synth_tier2.
// Each of synth_* may contain {{synthesis_rules}}, which is substituted by getResolvedPrompt.

// ---------------------------------------------------------------------------
// Helper: resolveEventLabel
// ---------------------------------------------------------------------------

export function resolveEventLabel(
  evt: { type: string; config: Record<string, any> },
  cache: EnrichmentCache,
): string {
  // Without rule-editor-registry, fall back to humanising the type string
  const baseDesc = evt.type.replace(/_/g, " ");

  const formId = evt.config?.a0;
  if (
    formId &&
    (evt.type.includes("form") || evt.type.includes("fillout")) &&
    cache.forms?.[formId]
  ) {
    return `${baseDesc} (${cache.forms[formId]})`;
  }
  if (formId && evt.type.includes("landing_page") && cache.landing_pages?.[formId]) {
    return `${baseDesc} (${cache.landing_pages[formId]})`;
  }
  if (
    formId &&
    (evt.type.includes("email") ||
      (evt.type.includes("message") && !evt.type.startsWith("sms_"))) &&
    cache.messages?.[formId]
  ) {
    const msg = cache.messages[formId];
    const name = typeof msg === "string" ? msg : msg.subject;
    return `${baseDesc} (${name})`;
  }

  return baseDesc;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildNodeDetailsFromChunks(chunks: Chunk[]): NodeDetailLayer[] {
  return chunks.map((chunk) => ({
    chunk_id: chunk.id,
    chunk_narration: chunk.narration || "",
    nodes: chunk.node_details.map((nd) => ({
      id: nd.id,
      type: nd.type,
      label: nd.label,
      resolved_description: nd.label || nd.type,
      timing:
        nd.cumulative_elapsed.days > 0 ||
        nd.cumulative_elapsed.hours > 0 ||
        nd.cumulative_elapsed.minutes > 0
          ? nd.cumulative_elapsed
          : null,
    })),
  }));
}

function titleCase(str: string): string {
  return str
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function buildTriggerHeader(
  trigger: Chunk,
  triggerNumber: number,
  cache: EnrichmentCache,
): string {
  const trigNode = trigger.node_details[0];
  if (!trigNode) return `Trigger ${triggerNumber} - Unknown`;

  const label = (trigNode.label || "UNKNOWN TRIGGER").replace(/\.$/, "");
  const events = trigger.trigger_goal_semantics?.events || [];

  if (events.length > 1) {
    const eventLabels = events.map((evt) => resolveEventLabel(evt, cache));
    return `Trigger ${triggerNumber} - ${eventLabels.join(" + ")}`;
  }

  if (events.length === 1) {
    return `Trigger ${triggerNumber} - ${resolveEventLabel(events[0], cache)}`;
  }

  const labelTitle = titleCase(label);
  let extra = "";
  if (
    label.toUpperCase().includes("SUBMITS FORM") ||
    label.toUpperCase().includes("FORM")
  ) {
    for (const evt of events) {
      const formId = evt.config?.a0;
      if (formId && cache.forms?.[formId]) {
        extra = ` (${cache.forms[formId]})`;
        break;
      }
    }
  }

  return `Trigger ${triggerNumber} - ${labelTitle}${extra}`;
}

function resolveSemanticBranchLabel(child: Chunk, allChunks: Chunk[]): string {
  if (!child.branch_label) return "";
  if (child.branch_label === "yes" || child.branch_label === "no") {
    const parent = allChunks.find((c) => c.sub_chunks.includes(child.id));
    if (parent?.fork_type === "condition") {
      return child.branch_label === "yes"
        ? " (condition matched)"
        : " (condition NOT matched)";
    }
  }
  return ` (${child.branch_label})`;
}

function buildConditionForkNote(
  parent: Chunk,
  allChunks: Chunk[],
): string | null {
  if (parent.fork_type !== "condition" || parent.sub_chunks.length === 0)
    return null;
  const parts: string[] = [];
  for (const subId of parent.sub_chunks) {
    const sub = allChunks.find((c) => c.id === subId);
    if (sub?.branch_label === "yes") {
      parts.push(`${subId} is the 'condition matched' path`);
    } else if (sub?.branch_label === "no") {
      parts.push(`${subId} is the 'condition NOT matched' path`);
    }
  }
  if (parts.length === 0) return null;
  return `[NOTE: Condition fork — ${parts.join("; ")}.]`;
}

function orderChunksByHierarchy(
  childChunks: Chunk[],
  triggerSubChunks: string[],
): Chunk[] {
  const chunkMap = new Map(childChunks.map((c) => [c.id, c]));
  const ordered: Chunk[] = [];
  const seen = new Set<string>();

  const branchSortKey = (id: string): number => {
    const label = (chunkMap.get(id)?.branch_label || "").toLowerCase();
    if (label === "yes" || label === "goal_achieved") return 0;
    if (label === "no" || label === "proceed_if_not_achieved") return 2;
    return 1;
  };

  function visit(id: string) {
    if (seen.has(id)) return;
    const chunk = chunkMap.get(id);
    if (!chunk) return;
    seen.add(id);
    ordered.push(chunk);
    const sortedSubs = [...chunk.sub_chunks].sort(
      (a, b) => branchSortKey(a) - branchSortKey(b),
    );
    for (const subId of sortedSubs) {
      visit(subId);
    }
  }

  const sortedRoots = [...triggerSubChunks].sort(
    (a, b) => branchSortKey(a) - branchSortKey(b),
  );
  for (const id of sortedRoots) {
    visit(id);
  }

  for (const chunk of childChunks) {
    if (!seen.has(chunk.id)) {
      ordered.push(chunk);
    }
  }

  return ordered;
}

// ---------------------------------------------------------------------------
// buildSynthesisPrompt — structural overview + chunk narrations for LLM
// ---------------------------------------------------------------------------

function buildSynthesisPrompt(
  chunks: Chunk[],
  relationships: Relationship[],
  cache: EnrichmentCache,
): string {
  const lines: string[] = [];

  const triggerChunks = chunks.filter((c) => c.entry_type === "trigger");
  const branchChunks = chunks.filter((c) => c.entry_type !== "trigger");

  const chunkParentMap = new Map<string, string>();
  for (const chunk of chunks) {
    for (const subId of chunk.sub_chunks) {
      chunkParentMap.set(subId, chunk.id);
    }
  }

  const contSourceMap = new Map<string, string>();
  for (const rel of relationships) {
    if (rel.type === "continues_to") {
      contSourceMap.set(rel.to, rel.from);
    }
  }

  const findRootTrigger = (chunkId: string): string | null => {
    let current = chunkId;
    const visited = new Set<string>();
    while (current && !visited.has(current)) {
      visited.add(current);
      const chunk = chunks.find((c) => c.id === current);
      if (chunk?.entry_type === "trigger") return current;
      const parent =
        chunkParentMap.get(current) ||
        contSourceMap.get(current) ||
        chunk?.parent_chunk_id ||
        null;
      if (!parent) return null;
      current = parent;
    }
    return null;
  };

  const sortedTriggers = [...triggerChunks].sort((a, b) => {
    const orderA = parseInt(a.node_details[0]?.resource?.order ?? "999", 10);
    const orderB = parseInt(b.node_details[0]?.resource?.order ?? "999", 10);
    return orderA - orderB;
  });

  const triggerHeaders = new Map<string, string>();
  for (let i = 0; i < sortedTriggers.length; i++) {
    const header = buildTriggerHeader(sortedTriggers[i], i + 1, cache);
    triggerHeaders.set(sortedTriggers[i].id, header);
  }

  lines.push("# Automation Structure\n");
  lines.push(
    "## Trigger Headers (use EXACTLY as section headers in behavioral_summary):",
  );
  for (const [chunkId, header] of triggerHeaders) {
    lines.push(`  - ${chunkId}: "${header}"`);
  }
  lines.push("");

  lines.push("## Structural Overview");
  for (const trigger of sortedTriggers) {
    const header = triggerHeaders.get(trigger.id) || trigger.id;
    lines.push(`### ${header}`);
    if ((trigger as any).semantic_summary)
      lines.push(`  Structure: ${(trigger as any).semantic_summary}`);
    if (trigger.sub_chunks.length > 0) {
      lines.push(`  Branches: ${trigger.sub_chunks.join(", ")}`);
    }
    const childChunks = orderChunksByHierarchy(
      branchChunks.filter((c) => findRootTrigger(c.id) === trigger.id),
      trigger.sub_chunks,
    );
    const goalChildren = childChunks.filter(
      (c) => c.entry_type === "goal" && c.parent_chunk_id === trigger.id,
    );
    if (goalChildren.length > 1) {
      lines.push(
        `  ⚑ Multi-Goal Wait: ${goalChildren.length} parallel goal paths branch from this trigger's wait step. Describe each path independently.`,
      );
    }
    for (const child of childChunks) {
      const branchDesc = resolveSemanticBranchLabel(child, chunks);
      const waitGoalNote =
        child.fork_type === "wait_goal"
          ? " [Wait+Goal: has achieved and fallback paths]"
          : "";
      lines.push(
        `  - ${child.id}${branchDesc}: ${(child as any).semantic_summary || ""}${waitGoalNote}`,
      );
    }
    lines.push("");
  }

  lines.push(
    "## Chunk Narrations (detailed descriptions — use for accuracy)",
  );

  const emitStructuredMeta = (chunk: Chunk) => {
    const cn = (chunk as any).chunk_narration;
    if (!cn) return;
    const metaLines: string[] = [];
    if (cn.entities_mentioned?.length > 0) {
      metaLines.push(`  Entities (MUST appear in output): ${cn.entities_mentioned.join(", ")}`);
    }
    if (cn.wait_description) {
      metaLines.push(`  Wait: ${cn.wait_description}`);
    }
    if (cn.condition_description) {
      metaLines.push(`  Condition: ${cn.condition_description}`);
    }
    if (cn.goto_target_description) {
      metaLines.push(`  GoTo: ${cn.goto_target_description}`);
    }
    if (cn.end_mode) {
      const endDesc = cn.end_mode === "move_to_automation"
        ? `Ends by moving contacts to "${cn.end_target || "another automation"}"`
        : cn.end_mode === "exit"
        ? "Ends by removing contacts from the automation"
        : "Ends (contacts remain on the map)";
      metaLines.push(`  Exit: ${endDesc}`);
    }
    if (metaLines.length > 0) {
      lines.push("[Structured facts — use these for accuracy:]");
      for (const ml of metaLines) lines.push(ml);
    }
  };

  for (const trigger of sortedTriggers) {
    const header = triggerHeaders.get(trigger.id) || trigger.id;
    lines.push(`### ${header} [${trigger.id}]`);
    if (trigger.narration) lines.push(trigger.narration);
    emitStructuredMeta(trigger);
    if (trigger.goto_target_node) {
      lines.push(`Goto target: node ${trigger.goto_target_node}`);
    }
    const condNote = buildConditionForkNote(trigger, chunks);
    if (condNote) lines.push(condNote);
    lines.push("");

    const childChunks = orderChunksByHierarchy(
      branchChunks.filter((c) => findRootTrigger(c.id) === trigger.id),
      trigger.sub_chunks,
    );
    for (const child of childChunks) {
      const branchDesc = resolveSemanticBranchLabel(child, chunks);
      lines.push(`[${child.id}]${branchDesc}:`);
      if (child.fork_type === "wait_goal") {
        lines.push(
          `[NOTE: This is a Wait+Goal pattern. The wait has a time limit. If the goal is achieved, the contact follows the goal_achieved sub-branch. If the wait expires without the goal being met, the contact follows the proceed_if_not_achieved fallback sub-branch.]`,
        );
      }
      const childCondNote = buildConditionForkNote(child, chunks);
      if (childCondNote) lines.push(childCondNote);
      if (child.narration) lines.push(child.narration);
      emitStructuredMeta(child);
      if (child.sub_chunks.length > 0) {
        lines.push(`Sub-branches: ${child.sub_chunks.join(", ")}`);
      }
      lines.push("");
    }
  }

  if (relationships.length > 0) {
    lines.push("## Relationships");
    for (const rel of relationships) {
      lines.push(
        `- ${rel.from} → ${rel.to} [${rel.type}]${rel.condition ? ` (${rel.condition})` : ""}`,
      );
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// groupChunksByTrigger
// ---------------------------------------------------------------------------

interface TriggerGroup {
  triggerChunk: Chunk;
  childChunks: Chunk[];
  relationships: Relationship[];
  triggerNumber: number;
  header: string;
}

function groupChunksByTrigger(
  chunks: Chunk[],
  relationships: Relationship[],
  cache: EnrichmentCache,
): TriggerGroup[] {
  const chunkMap = new Map<string, Chunk>();
  for (const c of chunks) chunkMap.set(c.id, c);

  const chunkParentMap = new Map<string, string>();
  for (const chunk of chunks) {
    for (const subId of chunk.sub_chunks) {
      chunkParentMap.set(subId, chunk.id);
    }
  }

  const continuationSourceMap = new Map<string, string>();
  for (const rel of relationships) {
    if (rel.type === "continues_to") {
      continuationSourceMap.set(rel.to, rel.from);
    }
  }

  const findRootTrigger = (chunkId: string): string | null => {
    let current = chunkId;
    const visited = new Set<string>();
    while (current && !visited.has(current)) {
      visited.add(current);
      const chunk = chunkMap.get(current);
      if (chunk?.entry_type === "trigger") return current;
      const parent =
        chunkParentMap.get(current) ||
        continuationSourceMap.get(current) ||
        chunk?.parent_chunk_id ||
        null;
      if (!parent) return null;
      current = parent;
    }
    return null;
  };

  const triggerChunks = chunks.filter((c) => c.entry_type === "trigger");
  const sortedTriggers = [...triggerChunks].sort((a, b) => {
    const orderA = parseInt(a.node_details[0]?.resource?.order ?? "999", 10);
    const orderB = parseInt(b.node_details[0]?.resource?.order ?? "999", 10);
    return orderA - orderB;
  });

  const groups: TriggerGroup[] = [];
  for (let i = 0; i < sortedTriggers.length; i++) {
    const trigger = sortedTriggers[i];
    const header = buildTriggerHeader(trigger, i + 1, cache);
    const childChunks = orderChunksByHierarchy(
      chunks.filter(
        (c) =>
          c.entry_type !== "trigger" && findRootTrigger(c.id) === trigger.id,
      ),
      trigger.sub_chunks,
    );
    const groupChunkIds = new Set([
      trigger.id,
      ...childChunks.map((c) => c.id),
    ]);
    const groupRels = relationships.filter(
      (r) => groupChunkIds.has(r.from) || groupChunkIds.has(r.to),
    );
    groups.push({
      triggerChunk: trigger,
      childChunks,
      relationships: groupRels,
      triggerNumber: i + 1,
      header,
    });
  }
  return groups;
}

// ---------------------------------------------------------------------------
// synthesizeTriggerGroup — Tier 1: one LLM call per trigger path
// ---------------------------------------------------------------------------

const TIERED_CHUNK_THRESHOLD = 15;
const TIER1_CONCURRENCY = 4;

async function synthesizeTriggerGroup(
  group: TriggerGroup,
  cache: EnrichmentCache,
  records: LlmCallRecord[],
): Promise<{ description: string; llmMs: number }> {
  const lines: string[] = [];

  lines.push(`# Trigger Path: ${group.header}\n`);

  lines.push("## Chunk Narrations");
  lines.push(`### ${group.header} [${group.triggerChunk.id}]`);
  if (group.triggerChunk.narration) lines.push(group.triggerChunk.narration);
  if (group.triggerChunk.goto_target_node) {
    lines.push(`Goto target: node ${group.triggerChunk.goto_target_node}`);
  }
  const allGroupChunks = [group.triggerChunk, ...group.childChunks];
  const triggerCondNote = buildConditionForkNote(
    group.triggerChunk,
    allGroupChunks,
  );
  if (triggerCondNote) lines.push(triggerCondNote);
  lines.push("");

  for (const child of group.childChunks) {
    const branchDesc = resolveSemanticBranchLabel(child, allGroupChunks);
    lines.push(`[${child.id}]${branchDesc}:`);
    if (child.fork_type === "wait_goal") {
      lines.push(
        `[NOTE: This is a Wait+Goal pattern. The wait has a time limit. If the goal is achieved, the contact follows the goal_achieved sub-branch. If the wait expires without the goal being met, the contact follows the proceed_if_not_achieved fallback sub-branch.]`,
      );
    }
    const childCondNote = buildConditionForkNote(child, allGroupChunks);
    if (childCondNote) lines.push(childCondNote);
    if (child.narration) lines.push(child.narration);
    if (child.sub_chunks.length > 0) {
      lines.push(`Sub-branches: ${child.sub_chunks.join(", ")}`);
    }
    lines.push("");
  }

  const groupChunkIds = new Set([
    group.triggerChunk.id,
    ...group.childChunks.map((c) => c.id),
  ]);
  const internalRels = group.relationships.filter(
    (r) => groupChunkIds.has(r.from) && groupChunkIds.has(r.to),
  );
  const crossTriggerRels = group.relationships.filter(
    (r) => !(groupChunkIds.has(r.from) && groupChunkIds.has(r.to)),
  );

  if (internalRels.length > 0) {
    lines.push("## Relationships");
    for (const rel of internalRels) {
      lines.push(
        `- ${rel.from} → ${rel.to} [${rel.type}]${rel.condition ? ` (${rel.condition})` : ""}`,
      );
    }
  }

  if (crossTriggerRels.length > 0) {
    lines.push(
      "\n## Cross-trigger References (for context only — do not attribute these actions to this trigger path)",
    );
    for (const rel of crossTriggerRels) {
      lines.push(
        `- ${rel.from} → ${rel.to} [${rel.type}]${rel.condition ? ` (${rel.condition})` : ""}`,
      );
    }
  }

  const userPrompt = lines.join("\n");

  const llmStart = Date.now();
  let description: string;
  try {
    const tier1Prompt = await getResolvedPrompt("synth_tier1");
    const result = await askLLMJsonWithRecord<{
      behavioral_description: string;
    }>(
      tier1Prompt,
      userPrompt,
      { maxTokens: 4096, temperature: 0.3 },
      group.triggerChunk.id,
      records,
    );
    description =
      typeof result.behavioral_description === "string"
        ? result.behavioral_description
        : "";
  } catch {
    description = `[Synthesis failed for ${group.header}]`;
    return { description, llmMs: Date.now() - llmStart };
  }
  const llmMs = Date.now() - llmStart;

  return { description, llmMs };
}

// ---------------------------------------------------------------------------
// synthesizeTiered — multi-trigger automations
// ---------------------------------------------------------------------------

async function synthesizeTiered(
  chunks: Chunk[],
  relationships: Relationship[],
  cache: EnrichmentCache,
): Promise<SynthesizeResult> {
  const nodeDetails = buildNodeDetailsFromChunks(chunks);
  const groups = groupChunksByTrigger(chunks, relationships, cache);
  const records: LlmCallRecord[] = [];

  // Tier 1: synthesize each trigger group independently
  const tier1Results = await runWithConcurrency(
    groups,
    async (group) => {
      const { description } = await synthesizeTriggerGroup(
        group,
        cache,
        records,
      );
      return {
        header: group.header,
        description,
        triggerNumber: group.triggerNumber,
      };
    },
    TIER1_CONCURRENCY,
  );

  const triggerSummaries = [...tier1Results].sort(
    (a, b) => a.triggerNumber - b.triggerNumber,
  );

  // Tier 2: assemble all trigger descriptions into final output
  const assemblyLines: string[] = [];
  assemblyLines.push("# Pre-written Trigger Path Descriptions\n");
  assemblyLines.push(
    "Assemble these into the final intent and behavioral_summary.\n",
  );

  for (const summary of triggerSummaries) {
    assemblyLines.push(`## ${summary.header}`);
    assemblyLines.push(summary.description);
    assemblyLines.push("");
  }

  const assemblyPrompt = assemblyLines.join("\n");

  let layers: SemanticLayers;
  try {
    const tier2Prompt = await getResolvedPrompt("synth_tier2");
    const result = await askLLMJsonWithRecord<{
      intent: string;
      behavioral_summary: string;
    }>(
      tier2Prompt,
      assemblyPrompt,
      { maxTokens: 16384, temperature: 0.3 },
      "tier2-assembly",
      records,
    );

    layers = {
      intent:
        typeof result.intent === "string"
          ? result.intent
          : result.intent == null
            ? ""
            : String(result.intent),
      behavioral_summary:
        typeof result.behavioral_summary === "string"
          ? result.behavioral_summary
          : result.behavioral_summary == null
            ? ""
            : String(result.behavioral_summary),
      node_details: nodeDetails,
    };
  } catch {
    const fallbackSummary = triggerSummaries
      .map((s) => `${s.header}: ${s.description}`)
      .join("\n\n");
    layers = {
      intent:
        "[Tiered synthesis assembly failed — individual trigger descriptions available below]",
      behavioral_summary:
        fallbackSummary ||
        "[Synthesis failed — LLM did not return valid output]",
      node_details: nodeDetails,
    };
  }

  return {
    layers,
    llmCalls: records.length,
    llmCallRecords: records,
  };
}

// ---------------------------------------------------------------------------
// synthesize — main entry point
// ---------------------------------------------------------------------------

export async function synthesize(
  chunks: Chunk[],
  relationships: Relationship[],
  cache?: EnrichmentCache,
  isPublished: boolean = true,
): Promise<SynthesizeResult> {
  const defaultCache: EnrichmentCache = {
    fields: {},
    field_values: {},
    messages: {},
    tags: {},
    campaigns: {},
    products: {},
    forms: {},
    landing_pages: {},
    webhook_urls: {},
    tasks: {},
  };
  const effectiveCache = cache || defaultCache;

  // Tiered path for large automations
  if (chunks.length > TIERED_CHUNK_THRESHOLD) {
    return synthesizeTiered(chunks, relationships, effectiveCache);
  }

  // Non-tiered path: single LLM call
  const records: LlmCallRecord[] = [];
  const userPrompt = buildSynthesisPrompt(
    chunks,
    relationships,
    effectiveCache,
  );
  const nodeDetails = buildNodeDetailsFromChunks(chunks);

  let layers: SemanticLayers;
  try {
    const nonTieredPrompt = await getResolvedPrompt("synth_non_tiered");
    const result = await askLLMJsonWithRecord<{
      intent: string;
      behavioral_summary: string;
    }>(
      nonTieredPrompt,
      userPrompt,
      { maxTokens: 8192, temperature: 0.3 },
      "non-tiered",
      records,
    );

    layers = {
      intent:
        typeof result.intent === "string"
          ? result.intent
          : result.intent == null
            ? ""
            : String(result.intent),
      behavioral_summary:
        typeof result.behavioral_summary === "string"
          ? result.behavioral_summary
          : result.behavioral_summary == null
            ? ""
            : String(result.behavioral_summary),
      node_details: nodeDetails,
    };
  } catch {
    layers = {
      intent: "[Synthesis failed — LLM did not return valid output]",
      behavioral_summary:
        "[Synthesis failed — LLM did not return valid output]",
      node_details: nodeDetails,
    };
  }

  return {
    layers,
    llmCalls: records.length,
    llmCallRecords: records,
  };
}
