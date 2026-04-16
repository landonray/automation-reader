import { chatCompletion } from "../llm.js";
import type { Chunk, EnrichmentCache, GotoConvergence } from "./types.js";
import type { ChunkNarration } from "./types.js";
import { WARNING_MESSAGES } from "./structural-warnings.js";
import { buildEnrichmentNameMap } from "./rule-editor-registry.js";
import { runWithConcurrency } from "./concurrency.js";
import {
  buildTriggerOpening,
  buildGoalOpening,
  buildActionSentence,
  resolveConditionForDeterministic,
  buildConditionForkNarration,
  assembleTriggerNarration,
  assembleGoalNarration,
  assembleForkBranchWithGoalNarration,
  resolveSingleGoalDescription,
} from "./narrator-templates.js";
import type { ProfileLookup } from "./narrator-templates.js";
import {
  findGotoTargetDescription,
  buildWaitDescription,
  formatDuration,
  resolveNodeDescription,
} from "./narrator-goto.js";
import {
  SYSTEM_PROMPT,
  collectChunkProfileKeys,
  buildProfileContext,
  buildRegistryContext,
  buildChunkPrompt,
} from "./narrator-prompt.js";
import { getPromptContent } from "./prompt-loader.js";

export { findGotoTargetDescription } from "./narrator-goto.js";

const SENTENCE_TERMINATORS = /[.!?\)\]\"\u2019]$/;

export function isNarrationTruncated(narration: string, finishReason: string): boolean {
  if (finishReason === "length") return true;
  const trimmed = narration.trim();
  if (trimmed.length === 0) return false;
  return !SENTENCE_TERMINATORS.test(trimmed);
}

const CONCURRENCY_LIMIT = 8;

export function computeGotoConvergence(chunks: Chunk[], cache: EnrichmentCache): GotoConvergence {
  const gotoChunks = chunks.filter(c => c.goto_target_node);
  if (gotoChunks.length === 0) {
    return { is_convergent: false, primary_target_node_id: null, target_node_description: null, convergence_ratio: 0 };
  }
  const targetCounts = new Map<string, number>();
  for (const c of gotoChunks) {
    const target = c.goto_target_node!;
    targetCounts.set(target, (targetCounts.get(target) || 0) + 1);
  }
  let maxTarget = "";
  let maxCount = 0;
  for (const [target, count] of targetCounts) {
    if (count > maxCount) { maxTarget = target; maxCount = count; }
  }
  const ratio = maxCount / gotoChunks.length;
  const isConvergent = ratio >= 0.5 && gotoChunks.length >= 2;
  const targetDescription = isConvergent ? findGotoTargetDescription(maxTarget, chunks, cache) : null;
  return { is_convergent: isConvergent, primary_target_node_id: isConvergent ? maxTarget : null, target_node_description: targetDescription, convergence_ratio: ratio };
}

const SIMPLE_ACTION_TYPES = new Set([
  "send_email", "email", "email_notify",
  "change_field", "change_tags",
  "update_contact",
  "add_tag", "remove_tag",
  "wait",
  "assign_task", "create_task",
  "webhook",
  "add_to_campaign", "move_to_campaign", "remove_from_campaign",
  "give_wp_membership", "give wp membership access", "pilotpress_give",
  "remove_wp_membership", "remove wp membership access", "pilotpress_remove",
  "update_membership_access",
  "cancel_open_order",
  "ai_assistant", "ai assistant",
  "end",
]);

type DeterministicMode = "simple_actions" | "trigger" | "goal" | "fork_branch_goal" | "condition_fork" | false;

function canNarrateDeterministically(chunk: Chunk, profiles: ProfileLookup, cache: EnrichmentCache, allChunks?: Chunk[]): DeterministicMode {
  // Condition fork check
  if (chunk.is_fork_parent && chunk.fork_type === "condition") {
    const condDesc = resolveConditionForDeterministic(chunk, cache);
    if (!condDesc) return false;
    const nonCondNodes = chunk.node_details.filter(nd => {
      const t = (nd.type || "").toLowerCase();
      return t !== "condition" && t !== "note";
    });
    for (const nd of nonCondNodes) {
      const nType = (nd.type || "").toLowerCase();
      if (nType !== "trigger" && nType !== "goal" && !SIMPLE_ACTION_TYPES.has(nType)) return false;
    }
    return "condition_fork";
  }

  if (chunk.is_fork_parent) return false;

  // Trigger with simple action types check
  if (chunk.entry_type === "trigger") {
    const actionNodes = chunk.node_details.slice(1);
    for (const nd of actionNodes) {
      const nType = (nd.type || "").toLowerCase();
      if (!SIMPLE_ACTION_TYPES.has(nType) && nType !== "note" && nType !== "goto") return false;
    }
    return "trigger";
  }

  // Goal with simple action types check
  if (chunk.entry_type === "goal") {
    const actionNodes = chunk.node_details.slice(1);
    for (const nd of actionNodes) {
      const nType = (nd.type || "").toLowerCase();
      if (!SIMPLE_ACTION_TYPES.has(nType) && nType !== "note" && nType !== "goto") return false;
    }
    return "goal";
  }

  // Fork branch with goal
  if (chunk.entry_type === "fork_branch") {
    const hasGoalNode = chunk.node_details.some(nd => (nd.type || "").toLowerCase() === "goal");
    if (hasGoalNode) {
      const firstMeaningful = chunk.node_details.find(nd => (nd.type || "").toLowerCase() !== "note");
      if (!firstMeaningful || (firstMeaningful.type || "").toLowerCase() !== "goal") return false;
      for (const nd of chunk.node_details) {
        const nType = (nd.type || "").toLowerCase();
        if (!SIMPLE_ACTION_TYPES.has(nType) && nType !== "note" && nType !== "goal") return false;
      }
      return "fork_branch_goal";
    }
  }

  // Simple actions fallback
  for (const nd of chunk.node_details) {
    const nType = (nd.type || "").toLowerCase();
    if (!SIMPLE_ACTION_TYPES.has(nType) && nType !== "note" && nType !== "goto") return false;
  }

  return "simple_actions";
}

function findSingleGoalDesc(chunk: Chunk, cache: EnrichmentCache, allChunks?: Chunk[]): string | null {
  if (!allChunks || chunk.sub_chunks.length === 0) return null;
  const goalChunks = chunk.sub_chunks
    .map(scId => allChunks.find(c => c.id === scId))
    .filter((c): c is Chunk => c != null && c.entry_type === "goal");
  if (goalChunks.length !== 1) return null;
  return resolveSingleGoalDescription(goalChunks[0], cache);
}

export function buildDeterministicNarration(chunk: Chunk, cache: EnrichmentCache, profiles: ProfileLookup, allChunks?: Chunk[]): string {
  const sentences: string[] = [];
  const singleGoalDesc = findSingleGoalDesc(chunk, cache, allChunks);
  const hasGoals = allChunks
    ? chunk.sub_chunks.some(scId => {
        const sc = allChunks.find(c => c.id === scId);
        return sc != null && sc.entry_type === "goal";
      })
    : undefined;

  const terminationId = chunk.termination_node_id;

  for (const nd of chunk.node_details) {
    const nType = (nd.type || "").toLowerCase();
    const res = nd.resource || {};

    if (nType === "note" || nType === "goto") continue;

    if (nType === "wait") {
      const isTerminationWait = nd.id === terminationId;
      const waitDesc = buildWaitDescription(res, cache, isTerminationWait ? singleGoalDesc : null, isTerminationWait ? hasGoals : undefined);
      sentences.push((waitDesc || "Waits for a configured duration") + ".");
      continue;
    }

    if (nType === "end") {
      const removes = res.remove_contacts === "1";
      const moves = res.move_contacts === "1";
      const moveTarget = res.move_contacts_to;
      if (moves && moveTarget) {
        const targetName = cache.campaigns[moveTarget] || `Automation #${moveTarget}`;
        sentences.push(`Contact exits this automation and is immediately enrolled in "${targetName}".`);
      } else if (removes) {
        sentences.push("Contact is fully removed from the automation (exit mode).");
      } else {
        sentences.push("This path ends. The contact remains on the automation map and is still eligible for goal redirects.");
      }
      continue;
    }

    if ((nType === "send_email" || nType === "email") && res.object_id) {
      const id = String(res.object_id);
      const profileKey = `message.email:${id}`;
      const profile = profiles[profileKey];
      if (profile && profile.status === "ready") {
        const msg = cache.messages[id];
        const subject = msg?.subject || profile.objectName;
        sentences.push(`Sends the email "${subject}" — ${profile.profile.purpose}`);
        continue;
      }
      const msg = cache.messages[id];
      if (msg) {
        sentences.push(`Sends the email "${msg.subject}".`);
        continue;
      }
    }

    if ((nType === "send_email" || nType === "email") && (!res.object_id || res.object_id === "0")) {
      sentences.push("An unconfigured 'Send An Email' step is present (no email selected).");
      continue;
    }

    if (nType === "email_notify") {
      const emailId = res.email_selector || res.object_id;
      if (emailId) {
        const msg = cache.messages[String(emailId)];
        if (msg) {
          sentences.push(`Sends notification email "${msg.subject}".`);
          continue;
        }
      }
    }

    if (nType === "change_field" || nType === "update_contact" || res.update_contact_field) {
      const tmpl = buildActionSentence(nd, cache);
      if (tmpl) { sentences.push(tmpl); continue; }
    }

    if (nType === "change_tags" && res.tag_selector) {
      const tagList = res.tag_selector.list;
      const action = res.tag_selector.sub_unsub === "add_list" ? "Adds" : "Removes";
      if (Array.isArray(tagList) && tagList.length > 0) {
        const tagNames = tagList.map((t: any) => `"${cache.tags[t.value] || t.label || t.value}"`);
        sentences.push(`${action} tags: ${tagNames.join(", ")}.`);
        continue;
      }
    }

    if ((nType === "assign_task" || nType === "create_task") && res.object_id) {
      const taskName = cache.tasks[String(res.object_id)] || `Task #${res.object_id}`;
      sentences.push(`Assigns task "${taskName}".`);
      continue;
    }

    if (nType === "webhook") {
      const url = res.webhook_url || res.destination_url || res.url || "";
      const cleaned = cache.webhook_urls[url] || url;
      sentences.push(`Fires webhook to ${cleaned}.`);
      continue;
    }

    if (nType === "ai_assistant" || nType === "ai assistant") {
      const prompt = res.ai_prompt || res.prompt || "";
      const storeField = res.store_response_in ? (cache.fields[res.store_response_in] || res.store_response_in) : "";
      sentences.push(`AI assistant processes prompt "${prompt.substring(0, 80)}${prompt.length > 80 ? "..." : ""}"${storeField ? ` and stores the response in "${storeField}"` : ""}.`);
      continue;
    }

    if (nType === "update_membership_access") {
      const tmpl = buildActionSentence(nd, cache);
      if (tmpl) { sentences.push(tmpl); continue; }
    }

    const desc = resolveNodeDescription(nd, cache);
    sentences.push(desc + ".");
  }

  if (chunk.goto_target_node && allChunks) {
    const targetDesc = findGotoTargetDescription(chunk.goto_target_node, allChunks, cache);
    if (targetDesc.startsWith("VERBATIM_GOTO: ")) {
      const verbatim = targetDesc.replace("VERBATIM_GOTO: ", "");
      sentences.push(verbatim.charAt(0).toUpperCase() + verbatim.slice(1));
    } else {
      sentences.push(`The contact is routed via GoTo to ${targetDesc}.`);
    }
  }

  return sentences.join(" ").replace(/\.\./g, ".").trim();
}

export function resolveConditionForkOpening(chunk: Chunk, cache: EnrichmentCache, allChunks?: Chunk[]): string {
  const parentChunk = chunk.parent_chunk_id && allChunks
    ? allChunks.find(c => c.id === chunk.parent_chunk_id)
    : undefined;
  const parentIsTrigger = parentChunk?.entry_type === "trigger";
  if (parentIsTrigger) {
    return "At this point in the automation";
  } else if (chunk.entry_type === "trigger") {
    return buildTriggerOpening(chunk, cache);
  } else if (chunk.entry_type === "goal") {
    return buildGoalOpening(chunk, cache);
  } else {
    return "At this point in the automation";
  }
}

function narrateWarningChunk(chunk: Chunk, cache: EnrichmentCache): string {
  const warnings = chunk.structural_warnings || [];
  if (chunk.entry_type === "orphan") {
    const warningLines = warnings.map(w => w.message);
    return `[Structural Note] ${warningLines.join(" ")}`;
  }
  if (chunk.termination_type === "dead_end" && chunk.entry_type === "trigger") {
    const triggerDetail = chunk.node_details[0];
    const triggerLabel = triggerDetail?.label || triggerDetail?.type || "trigger";
    return `[Structural Note] ${WARNING_MESSAGES.dead_end_trigger(triggerLabel)}`;
  }
  return "";
}

// ============================================================
// ChunkNarration builder
// ============================================================

function buildChunkNarrationMeta(chunk: Chunk, prose: string, isDeterministic: boolean, cache: EnrichmentCache, allChunks: Chunk[]): ChunkNarration {
  const entities: string[] = [];
  for (const nd of chunk.node_details) {
    const res = nd.resource || {};
    const nType = (nd.type || "").toLowerCase();
    if ((nType === "send_email" || nType === "email") && res.object_id) {
      const msg = cache.messages[String(res.object_id)];
      if (msg) entities.push(`email:${msg.subject}`);
    }
    if (nType === "change_tags" && res.tag_selector?.list) {
      for (const t of res.tag_selector.list) {
        const name = cache.tags[t.value] || t.label || t.value;
        entities.push(`tag:${name}`);
      }
    }
    if (res.add_tag) entities.push(`tag:${cache.tags[res.add_tag] || res.add_tag}`);
    if (res.remove_tag) entities.push(`tag:${cache.tags[res.remove_tag] || res.remove_tag}`);
    if (res.update_contact_field) {
      const fname = cache.fields[res.update_contact_field] || res.update_contact_field;
      entities.push(`field:${fname}`);
    }
    if ((nType === "assign_task" || nType === "create_task") && res.object_id) {
      entities.push(`task:${cache.tasks[String(res.object_id)] || res.object_id}`);
    }
    if (res.form_id) entities.push(`form:${cache.forms[res.form_id] || res.form_id}`);
    if (res.campaign_id) entities.push(`campaign:${cache.campaigns[res.campaign_id] || res.campaign_id}`);
  }

  let waitDescription: string | undefined;
  let endMode: ChunkNarration["end_mode"];
  let endTarget: string | undefined;
  let gotoTargetDescription: string | undefined;
  let conditionDescription: string | undefined;

  const lastNode = chunk.node_details[chunk.node_details.length - 1];
  if (lastNode?.type === "wait") {
    const res = lastNode.resource || {};
    waitDescription = buildWaitDescription(res, cache) || undefined;
  }
  if (lastNode?.type === "end") {
    const res = lastNode.resource || {};
    if (res.move_contacts === "1" && res.move_contacts_to) {
      endMode = "move_to_automation";
      endTarget = cache.campaigns[res.move_contacts_to] || `Automation #${res.move_contacts_to}`;
    } else if (res.remove_contacts === "1") {
      endMode = "exit";
    } else {
      endMode = "end";
    }
  }
  if (chunk.goto_target_node) {
    const targetChunk = allChunks.find(c =>
      c.nodes.includes(chunk.goto_target_node!)
    );
    if (targetChunk) {
      const triggerChunks = allChunks.filter(c => c.entry_type === "trigger");
      const triggerIndex = triggerChunks.indexOf(targetChunk);
      if (triggerIndex >= 0) {
        gotoTargetDescription = `they are routed via GoTo into Trigger ${triggerIndex + 1}'s path`;
      } else {
        const targetLabel = targetChunk.node_details[0]?.label || targetChunk.id;
        gotoTargetDescription = `they are routed via GoTo to the "${targetLabel}" step`;
      }
    } else {
      gotoTargetDescription = `GoTo targeting node ${chunk.goto_target_node}`;
    }
  }
  if (chunk.is_fork_parent && chunk.fork_type === "condition") {
    conditionDescription = resolveConditionForDeterministic(chunk, cache) || undefined;
  }

  return {
    prose,
    entities_mentioned: entities,
    wait_description: waitDescription,
    end_mode: endMode,
    end_target: endTarget,
    goto_target_description: gotoTargetDescription,
    condition_description: conditionDescription,
    is_deterministic: isDeterministic,
  };
}

// ============================================================
// LLM call records and stats
// ============================================================

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

export interface NarratorStats {
  llmCalls: number;
  deterministicCalls: number;
  truncationRetries: number;
}

export interface NarrateResult {
  chunks: Chunk[];
  stats: NarratorStats;
  llmCallRecords: LlmCallRecord[];
}

// ============================================================
// Core narration
// ============================================================

interface PrecomputedContext {
  profileContext: string | null;
  registryContext: string | null;
}

interface NarrateOneResult {
  narration: string;
  isDeterministic: boolean;
  llmRecords: LlmCallRecord[];
}

async function narrateOneChunk(
  chunk: Chunk,
  cache: EnrichmentCache,
  allChunks: Chunk[],
  profiles?: ProfileLookup,
  feedbackPromptSection?: string,
  stats?: NarratorStats,
  isPublished: boolean = true,
  precomputed?: PrecomputedContext,
): Promise<NarrateOneResult> {
  const llmRecords: LlmCallRecord[] = [];

  if (chunk.structural_warnings && chunk.structural_warnings.length > 0 &&
      (chunk.entry_type === "orphan" || chunk.termination_type === "dead_end")) {
    const warningNarration = narrateWarningChunk(chunk, cache);
    if (warningNarration) {
      if (stats) stats.deterministicCalls++;
      return { narration: warningNarration, isDeterministic: true, llmRecords };
    }
  }

  const hasStructuralWarnings = !isPublished && chunk.structural_warnings && chunk.structural_warnings.length > 0;

  const effectiveProfiles: ProfileLookup = profiles || {};
  const detMode = canNarrateDeterministically(chunk, effectiveProfiles, cache, allChunks);
  if (detMode && detMode !== "simple_actions") {
    let det: string | null;
    if (detMode === "trigger") {
      det = assembleTriggerNarration(chunk, cache, effectiveProfiles, allChunks, findGotoTargetDescription);
    } else if (detMode === "goal") {
      det = assembleGoalNarration(chunk, cache, effectiveProfiles, allChunks, findGotoTargetDescription);
    } else if (detMode === "fork_branch_goal") {
      det = assembleForkBranchWithGoalNarration(chunk, cache, effectiveProfiles);
    } else if (detMode === "condition_fork") {
      const condDesc = resolveConditionForDeterministic(chunk, cache);
      const opening = resolveConditionForkOpening(chunk, cache, allChunks);
      const skipEntryNode = chunk.entry_type === "trigger" || chunk.entry_type === "goal";
      const sliceStart = skipEntryNode ? 1 : 0;
      const intermediateNodes = chunk.node_details.length > (sliceStart + 1)
        ? chunk.node_details.slice(sliceStart, -1).filter(nd => {
            const t = (nd.type || "").toLowerCase();
            return t !== "condition" && t !== "note" && t !== "trigger" && t !== "goal";
          })
        : [];
      const intermediateSentences = intermediateNodes
        .map(nd => buildActionSentence(nd, cache))
        .filter((s): s is string => s !== null);
      const intermediateText = intermediateSentences.length > 0
        ? intermediateSentences.join(" ").replace(/\.\s*$/, "")
        : undefined;
      det = buildConditionForkNarration(opening, condDesc || "a condition", intermediateText);
    } else {
      det = "";
    }
    if (det !== null) {
      let detResult = det;
      if (hasStructuralWarnings) {
        const warningNotes = chunk.structural_warnings!.map(w => w.message).join(" ");
        detResult += ` [Structural Note: ${warningNotes}]`;
      }
      if (stats) stats.deterministicCalls++;
      return { narration: detResult, isDeterministic: true, llmRecords };
    }
  }
  if (detMode === "simple_actions") {
    let det = buildDeterministicNarration(chunk, cache, effectiveProfiles, allChunks);
    if (hasStructuralWarnings) {
      const warningNotes = chunk.structural_warnings!.map(w => w.message).join(" ");
      det += ` [Structural Note: ${warningNotes}]`;
    }
    if (stats) stats.deterministicCalls++;
    return { narration: det, isDeterministic: true, llmRecords };
  }

  // LLM narration path
  const profileContext = precomputed
    ? precomputed.profileContext
    : (profiles ? buildProfileContext(chunk, profiles, cache) : null);
  const registryContext = precomputed
    ? precomputed.registryContext
    : buildRegistryContext(chunk, cache);
  const userPrompt = buildChunkPrompt(chunk, cache, allChunks);

  const contextParts: string[] = [];
  if (feedbackPromptSection) {
    contextParts.push(feedbackPromptSection);
  }
  if (profileContext) {
    contextParts.push(`SEMANTIC PROFILES (use these for richer, more specific descriptions of referenced objects — include their purpose and business context in your narration):\n${profileContext}`);
  }
  if (registryContext) {
    contextParts.push(registryContext);
  }
  if (hasStructuralWarnings) {
    const warningDescriptions = chunk.structural_warnings!.map(w => `- ${w.message}`).join("\n");
    contextParts.push(
      `STRUCTURAL CONTEXT (Unpublished Automation):\nThis automation is currently unpublished/draft. The following structural issues were detected in this chunk:\n${warningDescriptions}\n\nIncorporate these issues naturally into your description. Mention them factually without alarm — unpublished automations may have incomplete configurations that are expected during development.`
    );
  }

  const fullPrompt = contextParts.length > 0
    ? `${contextParts.join("\n\n")}\n\n---\n\n${userPrompt}`
    : userPrompt;

  const isComplex = chunk.is_fork_parent || chunk.node_details.length > 4 || chunk.sub_chunks.length > 0;
  const maxTokens = isComplex ? 2048 : 1024;
  const systemPrompt = await getPromptContent("narrator_system");
  const messages: Array<{ role: "system" | "user"; content: string }> = [
    { role: "system", content: systemPrompt },
    { role: "user", content: fullPrompt },
  ];

  if (stats) stats.llmCalls++;

  const llmStart = Date.now();
  const response = await chatCompletion({ messages, maxTokens, temperature: 0.3 });
  let narration = (response.content || "").trim();
  let finishReason = response.finish_reason || "stop";
  let llmMs = Date.now() - llmStart;

  llmRecords.push({
    stage: "narrator",
    chunkId: chunk.id,
    systemPrompt,
    userPrompt: fullPrompt,
    response: narration,
    finishReason,
    promptTokens: response.usage?.prompt_tokens,
    completionTokens: response.usage?.completion_tokens,
    latencyMs: llmMs,
    wasRetry: false,
  });

  if (isNarrationTruncated(narration, finishReason)) {
    if (stats) stats.truncationRetries++;

    const retryStart = Date.now();
    const retryResponse = await chatCompletion({ messages, maxTokens, temperature: 0.3 });
    const retryNarration = (retryResponse.content || "").trim();
    const retryFinishReason = retryResponse.finish_reason || "stop";
    const retryMs = Date.now() - retryStart;

    llmRecords.push({
      stage: "narrator",
      chunkId: chunk.id,
      systemPrompt,
      userPrompt: fullPrompt,
      response: retryNarration,
      finishReason: retryFinishReason,
      promptTokens: retryResponse.usage?.prompt_tokens,
      completionTokens: retryResponse.usage?.completion_tokens,
      latencyMs: retryMs,
      wasRetry: true,
    });

    if (!isNarrationTruncated(retryNarration, retryFinishReason)) {
      narration = retryNarration;
    } else {
      narration = retryNarration.length > narration.length ? retryNarration : narration;
    }
  }

  let result = narration;
  if (hasStructuralWarnings) {
    const warningNotes = chunk.structural_warnings!.map(w => w.message).join(" ");
    result += ` [Structural Note: ${warningNotes}]`;
  }
  return { narration: result, isDeterministic: false, llmRecords };
}

export async function narrateChunks(
  chunks: Chunk[],
  enrichmentCache: EnrichmentCache,
  profiles?: ProfileLookup,
  feedbackPromptSection?: string,
  isPublished: boolean = true,
): Promise<NarrateResult> {
  const convergence = computeGotoConvergence(chunks, enrichmentCache);
  enrichmentCache.goto_convergence = convergence;

  const profileLookup: ProfileLookup = profiles || {};
  const hasProfiles = Object.keys(profileLookup).length > 0;

  const nameMap = buildEnrichmentNameMap(enrichmentCache);

  const profileContextCache = new Map<string, string | null>();
  const registryContextCache = new Map<string, string | null>();
  for (const chunk of chunks) {
    profileContextCache.set(
      chunk.id,
      hasProfiles ? buildProfileContext(chunk, profileLookup, enrichmentCache) : null,
    );
    registryContextCache.set(chunk.id, buildRegistryContext(chunk, enrichmentCache, nameMap));
  }

  const stats: NarratorStats = { llmCalls: 0, deterministicCalls: 0, truncationRetries: 0 };
  const allLlmRecords: LlmCallRecord[] = [];

  const narrationMap = new Map<string, { narration: string; isDeterministic: boolean }>();

  await runWithConcurrency(
    chunks,
    async (chunk) => {
      try {
        const precomputed: PrecomputedContext = {
          profileContext: profileContextCache.get(chunk.id) ?? null,
          registryContext: registryContextCache.get(chunk.id) ?? null,
        };
        const result = await narrateOneChunk(chunk, enrichmentCache, chunks, hasProfiles ? profileLookup : undefined, feedbackPromptSection, stats, isPublished, precomputed);
        narrationMap.set(chunk.id, { narration: result.narration, isDeterministic: result.isDeterministic });
        allLlmRecords.push(...result.llmRecords);
        return result.narration;
      } catch (err) {
        narrationMap.set(chunk.id, { narration: "", isDeterministic: false });
        return "";
      }
    },
    CONCURRENCY_LIMIT,
  );

  const narratedChunks = chunks.map((chunk) => {
    const result = narrationMap.get(chunk.id) || { narration: "", isDeterministic: false };
    const chunkNarration = buildChunkNarrationMeta(chunk, result.narration, result.isDeterministic, enrichmentCache, chunks);
    return {
      ...chunk,
      narration: result.narration,
      chunk_narration: chunkNarration,
    };
  });

  return { chunks: narratedChunks, stats, llmCallRecords: allLlmRecords };
}
