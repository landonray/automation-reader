import type { Chunk, SemanticLayers } from "./types.js";

export type ValidationSeverity = "error" | "warning";

export interface ValidationIssue {
  rule: string;
  severity: ValidationSeverity;
  message: string;
  details?: string;
}

export interface ReaderValidationReport {
  passed: boolean;
  issues: ValidationIssue[];
  retried: boolean;
  retryStages?: ("narration" | "synthesis")[];
}

const RAW_ID_PATTERN = /\b(?:node_|edge_|chunk_)\d+\b/;
const NUMERIC_REF_PATTERN = /(?:field|tag|form|message|campaign|task|product|landing.?page)\s+#?\d{3,}/i;
const UNKNOWN_PLACEHOLDER_PATTERN = /\bunknown\s+(?:form|tag|field|task|email|message|campaign|automation|landing\s*page|product|webhook)\b/i;

const GENERIC_INTENT_PHRASES = [
  "this automation does things",
  "this automation performs actions",
  "automation processes contacts",
  "no information available",
];

function checkIntentSubstantive(layers: SemanticLayers): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const intent = (typeof layers.intent === "string" ? layers.intent : String(layers.intent || "")).trim();

  if (!intent) {
    issues.push({
      rule: "intent_empty",
      severity: "error",
      message: "Intent layer is empty",
    });
    return issues;
  }

  if (intent.length < 20) {
    issues.push({
      rule: "intent_too_short",
      severity: "warning",
      message: "Intent layer is very short and may lack substance",
      details: `Length: ${intent.length} characters`,
    });
  }

  const lower = intent.toLowerCase();
  for (const phrase of GENERIC_INTENT_PHRASES) {
    if (lower.includes(phrase)) {
      issues.push({
        rule: "intent_generic",
        severity: "warning",
        message: "Intent layer contains generic placeholder text",
        details: `Found: "${phrase}"`,
      });
      break;
    }
  }

  return issues;
}

function extractActionVocabulary(chunks: Chunk[]): Set<string> {
  const vocab = new Set<string>();
  for (const chunk of chunks) {
    for (const nd of chunk.node_details) {
      const label = (nd.label || "").toLowerCase();
      const type = (nd.type || "").toLowerCase();
      if (label.length > 2) vocab.add(label);
      if (type.length > 2) vocab.add(type);
    }
    if (chunk.narration) {
      const words = chunk.narration.toLowerCase().match(/\b[a-z]{4,}\b/g);
      if (words) {
        for (const w of words.slice(0, 20)) vocab.add(w);
      }
    }
  }
  return vocab;
}

function checkBehavioralSummarySubstantive(layers: SemanticLayers, chunks: Chunk[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const summary = (typeof layers.behavioral_summary === "string" ? layers.behavioral_summary : String(layers.behavioral_summary || "")).trim();

  if (!summary) {
    issues.push({
      rule: "behavioral_summary_empty",
      severity: "error",
      message: "Behavioral summary layer is empty",
    });
    return issues;
  }

  if (summary.length < 50) {
    issues.push({
      rule: "behavioral_summary_too_short",
      severity: "warning",
      message: "Behavioral summary is very short and may lack detail",
      details: `Length: ${summary.length} characters`,
    });
  }

  if (chunks.length > 0) {
    const vocab = extractActionVocabulary(chunks);
    const summaryLower = summary.toLowerCase();
    const matchCount = [...vocab].filter(term => summaryLower.includes(term)).length;
    if (vocab.size > 0 && matchCount === 0) {
      issues.push({
        rule: "behavioral_summary_disconnected",
        severity: "warning",
        message: "Behavioral summary does not reference any automation elements from chunks",
        details: `0 of ${vocab.size} vocabulary terms found in summary`,
      });
    }
  }

  return issues;
}

function checkNoRawReferences(layers: SemanticLayers, chunks: Chunk[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const coerce = (v: unknown): string => typeof v === "string" ? v : v == null ? "" : String(v);
  const textsToCheck = [
    { label: "intent", text: coerce(layers.intent) },
    { label: "behavioral_summary", text: coerce(layers.behavioral_summary) },
  ];

  for (const chunk of chunks) {
    if (chunk.narration) {
      textsToCheck.push({ label: `narration (${chunk.id})`, text: chunk.narration });
    }
  }

  for (const { label, text } of textsToCheck) {
    const rawMatch = RAW_ID_PATTERN.exec(text);
    if (rawMatch) {
      issues.push({
        rule: "raw_id_in_synthesis",
        severity: "warning",
        message: `Raw internal ID found in ${label}`,
        details: `Found: "${rawMatch[0]}"`,
      });
    }

    const numericMatch = NUMERIC_REF_PATTERN.exec(text);
    if (numericMatch) {
      issues.push({
        rule: "unresolved_numeric_ref",
        severity: "warning",
        message: `Possible unresolved numeric reference in ${label}`,
        details: `Found: "${numericMatch[0]}"`,
      });
    }

    const unknownMatch = UNKNOWN_PLACEHOLDER_PATTERN.exec(text);
    if (unknownMatch) {
      issues.push({
        rule: "unknown_placeholder",
        severity: "warning",
        message: `Unresolved "unknown" placeholder in ${label}`,
        details: `Found: "${unknownMatch[0]}"`,
      });
    }
  }

  return issues;
}

function checkNodeDetailsMapToChunks(layers: SemanticLayers, chunks: Chunk[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const chunkIds = new Set(chunks.map(c => c.id));

  for (const nd of layers.node_details) {
    if (!chunkIds.has(nd.chunk_id)) {
      issues.push({
        rule: "orphaned_node_detail",
        severity: "error",
        message: `Node detail references non-existent chunk "${nd.chunk_id}"`,
      });
    }
  }

  for (const chunk of chunks) {
    const hasDetail = layers.node_details.some(nd => nd.chunk_id === chunk.id);
    if (!hasDetail) {
      issues.push({
        rule: "missing_node_detail",
        severity: "warning",
        message: `Chunk "${chunk.id}" has no corresponding node detail entry`,
      });
    }
  }

  return issues;
}

function checkNarrations(chunks: Chunk[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const chunk of chunks) {
    if (!chunk.narration || chunk.narration.trim().length === 0) {
      issues.push({
        rule: "empty_narration",
        severity: "warning",
        message: `Chunk "${chunk.id}" has no narration`,
      });
    }
  }

  return issues;
}

function checkTriggerCoverage(layers: SemanticLayers, chunks: Chunk[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const triggerChunks = chunks.filter(c => c.entry_type === "trigger");
  const intentText = (typeof layers.intent === "string" ? layers.intent : "").toLowerCase();

  for (let i = 0; i < triggerChunks.length; i++) {
    const triggerLabel = `trigger ${i + 1}`;
    if (!intentText.includes(triggerLabel)) {
      issues.push({
        rule: "missing_trigger_in_intent",
        severity: "warning",
        message: `Trigger ${i + 1} (${triggerChunks[i].id}) has no corresponding "Trigger ${i + 1}:" line in intent`,
      });
    }
  }
  return issues;
}

function checkEntityCoverage(layers: SemanticLayers, chunks: Chunk[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const summaryLower = (typeof layers.behavioral_summary === "string" ? layers.behavioral_summary : "").toLowerCase();

  for (const chunk of chunks) {
    if (!chunk.chunk_narration) continue;
    for (const entity of chunk.chunk_narration.entities_mentioned) {
      const entityName = entity.split(":").slice(1).join(":").toLowerCase();
      if (entityName && entityName.length > 2 && !entityName.startsWith("mud-") && !summaryLower.includes(entityName)) {
        issues.push({
          rule: "entity_missing_from_summary",
          severity: "warning",
          message: `Entity "${entity}" mentioned in chunk ${chunk.id} narration does not appear in behavioral summary`,
        });
      }
    }
  }
  return issues;
}

function checkConditionForkBranches(chunks: Chunk[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const chunk of chunks) {
    if (!chunk.is_fork_parent || chunk.fork_type !== "condition") continue;
    if (chunk.sub_chunks.length < 2) {
      issues.push({
        rule: "condition_fork_missing_branch",
        severity: "warning",
        message: `Condition fork ${chunk.id} has fewer than 2 branches — both yes/no paths should be described`,
      });
    }
  }
  return issues;
}

function checkWaitGoalBothOutcomes(layers: SemanticLayers, chunks: Chunk[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const summaryLower = (typeof layers.behavioral_summary === "string" ? layers.behavioral_summary : "").toLowerCase();

  for (const chunk of chunks) {
    if (chunk.fork_type !== "wait_goal") continue;
    if (summaryLower.includes("waits indefinitely") && chunk.sub_chunks.length > 0) {
      issues.push({
        rule: "wait_goal_says_indefinitely",
        severity: "warning",
        message: `Wait+Goal chunk ${chunk.id} has goals but summary says "waits indefinitely"`,
      });
    }
  }
  return issues;
}

function checkNoConcurrentLanguageForConditions(layers: SemanticLayers, chunks: Chunk[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const summary = typeof layers.behavioral_summary === "string" ? layers.behavioral_summary : "";
  const concurrentPhrases = ["all contacts go down all paths", "simultaneously proceed", "all paths concurrently"];

  const hasConditionFork = chunks.some(c => c.is_fork_parent && c.fork_type === "condition");
  if (!hasConditionFork) return issues;

  for (const phrase of concurrentPhrases) {
    if (summary.toLowerCase().includes(phrase)) {
      issues.push({
        rule: "concurrent_language_for_condition",
        severity: "warning",
        message: `Behavioral summary uses concurrent language ("${phrase}") but automation has condition forks (which are exclusive, not concurrent)`,
      });
    }
  }
  return issues;
}

export function validateReaderOutput(
  layers: SemanticLayers,
  chunks: Chunk[],
): ReaderValidationReport {
  const issues: ValidationIssue[] = [
    ...checkIntentSubstantive(layers),
    ...checkBehavioralSummarySubstantive(layers, chunks),
    ...checkNoRawReferences(layers, chunks),
    ...checkNodeDetailsMapToChunks(layers, chunks),
    ...checkNarrations(chunks),
    ...checkTriggerCoverage(layers, chunks),
    ...checkEntityCoverage(layers, chunks),
    ...checkConditionForkBranches(chunks),
    ...checkWaitGoalBothOutcomes(layers, chunks),
    ...checkNoConcurrentLanguageForConditions(layers, chunks),
  ];

  const hasErrors = issues.some(i => i.severity === "error");

  return {
    passed: !hasErrors,
    issues,
    retried: false,
    retryStages: [],
  };
}

export function buildCorrectionDirective(issues: ValidationIssue[]): string {
  const lines: string[] = [
    "\n# VALIDATION CORRECTIONS (mandatory)",
    "",
    "The previous output failed validation. Fix ALL of the following issues:",
    "",
  ];

  for (const issue of issues) {
    lines.push(`- [${issue.severity.toUpperCase()}] ${issue.message}${issue.details ? ` — ${issue.details}` : ""}`);
  }

  lines.push("");
  lines.push("Ensure the output is substantive, uses resolved names instead of raw IDs, and covers all chunks.");

  return lines.join("\n");
}

export function getSynthesisIssues(issues: ValidationIssue[]): ValidationIssue[] {
  const synthesisRules = new Set([
    "intent_empty",
    "intent_too_short",
    "intent_generic",
    "behavioral_summary_empty",
    "behavioral_summary_too_short",
    "behavioral_summary_disconnected",
    "raw_id_in_synthesis",
    "unresolved_numeric_ref",
    "unknown_placeholder",
    "orphaned_node_detail",
    "missing_node_detail",
  ]);
  return issues.filter(i => synthesisRules.has(i.rule));
}

export function getNarrationIssues(issues: ValidationIssue[]): ValidationIssue[] {
  return issues.filter(i => i.rule === "empty_narration");
}

export function getChunksNeedingRenarration(issues: ValidationIssue[]): string[] {
  return issues
    .filter(i => i.rule === "empty_narration")
    .map(i => {
      const match = i.message.match(/Chunk "([^"]+)"/);
      return match ? match[1] : "";
    })
    .filter(Boolean);
}

export function findEmptyNarrationChunkIds(chunks: Array<{ id: string; narration?: string }>): string[] {
  return chunks
    .filter(c => !c.narration || c.narration.trim().length === 0)
    .map(c => c.id);
}
