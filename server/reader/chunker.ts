import type {
  CampaignData,
  OntraportNode,
  OntraportEdge,
  Chunk,
  Relationship,
  RelationshipType,
  TerminationType,
  EntryType,
  ForkType,
  Duration,
  NodeDetail,
  TriggerGoalSemantics,
  EnrichmentCache,
} from "./types";
import { WARNING_MESSAGES, type StructuralWarning } from "./structural-warnings";

const FORK_NODE_TYPES = new Set(["condition", "split", "fork"]);
const IGNORED_NODE_TYPES = new Set(["note"]);
const TERMINATOR_TYPES = new Set(["end", "exit"]);

function zeroDuration(): Duration {
  return { days: 0, hours: 0, minutes: 0 };
}

function addDuration(a: Duration, b: Duration): Duration {
  let minutes = a.minutes + b.minutes;
  let hours = a.hours + b.hours;
  let days = a.days + b.days;
  hours += Math.floor(minutes / 60);
  minutes = minutes % 60;
  days += Math.floor(hours / 24);
  hours = hours % 24;
  return { days, hours, minutes };
}

function parseWaitDuration(node: OntraportNode): Duration {
  const resource = node.resource || node.data || {};

  const timeDays = parseInt(resource.time_days || "0", 10) || 0;
  const timeHours = parseInt(resource.time_hours || "0", 10) || 0;
  const timeMinutes = parseInt(resource.time_minutes || "0", 10) || 0;

  if (timeDays > 0 || timeHours > 0 || timeMinutes > 0) {
    return { days: timeDays, hours: timeHours, minutes: timeMinutes };
  }

  const value = parseInt(resource.wait_value || resource.value || "0", 10) || 0;
  const unit = resource.wait_unit || resource.unit || "days";
  if (value > 0) {
    switch (unit) {
      case "minutes":
        return { days: 0, hours: 0, minutes: value };
      case "hours":
        return { days: 0, hours: value, minutes: 0 };
      case "days":
      default:
        return { days: value, hours: 0, minutes: 0 };
    }
  }

  return zeroDuration();
}

function durationToMinutes(d: Duration): number {
  return d.days * 1440 + d.hours * 60 + d.minutes;
}

function minutesToDuration(totalMinutes: number): Duration {
  const abs = Math.max(0, totalMinutes);
  const days = Math.floor(abs / 1440);
  const hours = Math.floor((abs % 1440) / 60);
  const minutes = abs % 60;
  return { days, hours, minutes };
}

function computeSegmentDuration(details: NodeDetail[]): Duration {
  if (details.length === 0) return zeroDuration();
  const last = details[details.length - 1];
  const first = details[0];
  const diff = durationToMinutes(last.cumulative_elapsed) - durationToMinutes(first.cumulative_elapsed);
  return minutesToDuration(diff);
}

function extractTriggerGoalSemantics(node: OntraportNode): TriggerGoalSemantics {
  const resource = node.resource || node.data || {};

  const scopeRaw = resource.object_activate || resource.scope || resource.who || "any";
  let scope: TriggerGoalSemantics["scope"] = "account";
  if (scopeRaw === "campaign" || scopeRaw === "this_campaign") {
    scope = "campaign";
  } else if (scopeRaw === "wait" || scopeRaw === "wait_above") {
    scope = "wait_above";
  }

  const collisionRaw = resource.trigger_repeat_action || resource.collision || resource.already_on_map || "ignore";
  let collision: TriggerGoalSemantics["collision"] = "ignore";
  if (collisionRaw === "copy" || collisionRaw === "add" || collisionRaw === "add_again") {
    collision = "add_again";
  } else if (collisionRaw === "move") {
    collision = "move";
  }

  const is_convergence_point =
    collision === "move" && (scope === "account" || scope === "campaign");
  const is_clone_point = collision === "add_again";

  const ruleEditor = resource.rule_editor || {};
  const ruleEvents = ruleEditor.events?.statement || [];
  const fallbackEvents = node.events || resource.events || [];
  const rawEvents = Array.isArray(ruleEvents) && ruleEvents.length > 0 ? ruleEvents : fallbackEvents;

  const parsedEvents = Array.isArray(rawEvents)
    ? rawEvents.map((e: any) => {
        if (typeof e === "object" && !Array.isArray(e)) {
          const keys = Object.keys(e);
          if (keys.length === 1 && typeof e[keys[0]] === "object") {
            return { type: keys[0], config: e[keys[0]] };
          }
        }
        return {
          type: e.type || e.event_type || "unknown",
          config: e.config || e.data || e,
        };
      })
    : [];

  return {
    scope,
    collision,
    is_convergence_point,
    is_clone_point,
    events: parsedEvents,
  };
}

function buildNodeDetail(
  node: OntraportNode,
  cumulativeElapsed: Duration,
): NodeDetail {
  return {
    id: node.id,
    type: node.type,
    label: node.label || node.name || node.alias || node.type,
    resource: node.resource || node.data || {},
    cumulative_elapsed: { ...cumulativeElapsed },
  };
}

interface GraphContext {
  nodesMap: Map<string, OntraportNode>;
  adjacency: Map<string, OntraportEdge[]>;
  incomingEdges: Map<string, OntraportEdge[]>;
  gotoEdges: Map<string, OntraportEdge>;
  chunks: Chunk[];
  relationships: Relationship[];
  chunkCounter: number;
  emittedConvergence: Set<string>;
  isPublished: boolean;
  unconfiguredNodeIds: Set<string>;
  visitedNodeIds: Set<string>;
}

function getEdgeLabel(edge: OntraportEdge): string | null {
  const handle = (edge.sourceHandle || "").toLowerCase();
  if (handle.includes("yes") || handle === "true") return "yes";
  if (handle.includes("no") || handle === "false") return "no";
  if (handle.includes("goto") || handle.includes("go_to")) return "goto";
  if (handle.includes("default")) return "default";

  const edgeType = (edge.type || "").toLowerCase();
  if (edgeType === "yes") return "yes";
  if (edgeType === "no") return "no";
  if (edgeType === "goto") return "goto";

  if (edge.data?.label) return edge.data.label;
  return null;
}

function nextChunkId(ctx: GraphContext, prefix: string): string {
  ctx.chunkCounter++;
  return `${prefix}_${ctx.chunkCounter}`;
}

function walkChain(
  ctx: GraphContext,
  startNodeId: string,
  entryType: EntryType,
  parentChunkId: string | null,
  branchLabel: string | null,
  _enrichmentCache: EnrichmentCache,
  pathVisited?: Set<string>,
): string | null {
  const startNode = ctx.nodesMap.get(startNodeId);
  if (!startNode) return null;

  if (IGNORED_NODE_TYPES.has(startNode.type)) return null;

  const localPath = new Set(pathVisited || []);

  let effectiveEntryType = entryType;
  let effectiveBranchLabel = branchLabel;

  if (entryType === "fork_branch" && (startNode.type === "goal" || startNode.type === "trigger")) {
    effectiveEntryType = startNode.type === "trigger" ? "trigger" : "goal";
    const nodeLabel = startNode.label || startNode.name || startNode.alias || startNode.type;
    effectiveBranchLabel = `${startNode.type}: ${nodeLabel}`;
  }

  const chunkId = nextChunkId(
    ctx,
    effectiveEntryType === "trigger"
      ? "trigger"
      : effectiveEntryType === "goal"
        ? "goal"
        : "branch",
  );

  const chunk: Chunk = {
    id: chunkId,
    entry_type: effectiveEntryType,
    entry_node_id: startNodeId,
    nodes: [],
    termination_type: "open_ended",
    termination_node_id: null,
    sub_chunks: [],
    parent_chunk_id: parentChunkId,
    branch_label: effectiveBranchLabel,
    goto_target_node: null,
    cross_ref_campaign_id: null,
    trigger_goal_semantics: null,
    is_fork_parent: false,
    fork_type: null,
    branches_are_concurrent: false,
    split_test_weights: null,
    node_details: [],
    total_duration: zeroDuration(),
  };

  if (effectiveEntryType === "trigger" || effectiveEntryType === "goal") {
    chunk.trigger_goal_semantics = extractTriggerGoalSemantics(startNode);
  }

  if (!ctx.isPublished && effectiveEntryType === "goal") {
    const goalResource = startNode.resource || startNode.data || {};
    const ruleEditor = goalResource.rule_editor;
    const ruleEditorEvents = ruleEditor?.events?.statement;
    const hasRuleEditorEvents = Array.isArray(ruleEditorEvents) ? ruleEditorEvents.length > 0 : !!ruleEditorEvents;
    const events = goalResource.events || goalResource.trigger_events;
    const hasDirectEvents = Array.isArray(events) ? events.length > 0 : !!events;
    const isValid = goalResource.isValid;
    const hasEvents = hasRuleEditorEvents || hasDirectEvents || isValid === "true" || isValid === true;
    if (!hasEvents) {
      if (!chunk.structural_warnings) chunk.structural_warnings = [];
      const goalLabel = startNode.label || startNode.name || startNode.alias || "Goal";
      chunk.structural_warnings.push({
        category: "unconfigured_goal",
        node_id: startNodeId,
        message: WARNING_MESSAGES.unconfigured_goal(goalLabel),
      });
    }
  }

  let currentNodeId: string | null = startNodeId;
  let cumulativeElapsed = zeroDuration();

  while (currentNodeId) {
    if (localPath.has(currentNodeId) && currentNodeId !== startNodeId) {
      chunk.termination_type = "goto";
      chunk.termination_node_id = currentNodeId;
      chunk.goto_target_node = currentNodeId;
      break;
    }

    const currentNode = ctx.nodesMap.get(currentNodeId);
    if (!currentNode) break;

    if (IGNORED_NODE_TYPES.has(currentNode.type)) {
      const skipEdges: OntraportEdge[] = ctx.adjacency.get(currentNodeId) || [];
      currentNodeId = skipEdges.length > 0 ? skipEdges[0].target : null;
      continue;
    }

    if (
      currentNodeId !== startNodeId &&
      (currentNode.type === "trigger" || currentNode.type === "goal")
    ) {
      chunk.termination_type = "waiting_for_goal";
      chunk.termination_node_id = currentNodeId;

      const goalChunkId = walkChain(
        ctx,
        currentNodeId,
        "goal",
        chunkId,
        null,
        _enrichmentCache,
        localPath,
      );

      if (goalChunkId) {
        chunk.sub_chunks.push(goalChunkId);
        const goalChunk = ctx.chunks.find((c) => c.id === goalChunkId);
        const isConvergence =
          goalChunk?.trigger_goal_semantics?.is_convergence_point || false;

        ctx.relationships.push({
          from: chunkId,
          to: goalChunkId,
          type: isConvergence ? "goal_convergence" : "goal_reached",
          condition: null,
        });
      }
      break;
    }

    localPath.add(currentNodeId);
    ctx.visitedNodeIds.add(currentNodeId);
    chunk.nodes.push(currentNodeId);

    if (!ctx.isPublished && ctx.unconfiguredNodeIds.has(currentNodeId)) {
      if (!chunk.structural_warnings) chunk.structural_warnings = [];
      const nodeLabel = currentNode.label || currentNode.name || currentNode.alias || currentNode.type;
      chunk.structural_warnings.push({
        category: "unconfigured_node",
        node_id: currentNodeId,
        message: WARNING_MESSAGES.unconfigured_node(nodeLabel, currentNode.type),
      });
    }

    if (currentNode.type === "wait") {
      const waitDur = parseWaitDuration(currentNode);
      cumulativeElapsed = addDuration(cumulativeElapsed, waitDur);
    }

    chunk.node_details.push(buildNodeDetail(currentNode, cumulativeElapsed));

    if (TERMINATOR_TYPES.has(currentNode.type)) {
      chunk.termination_type = currentNode.type as TerminationType;
      chunk.termination_node_id = currentNodeId;
      break;
    }

    if (currentNode.type === "goto") {
      const resource = currentNode.resource || currentNode.data || {};
      let targetId = resource.target_node || resource.goto_node || resource.target;
      if (!targetId) {
        const gotoEdge = ctx.gotoEdges.get(currentNodeId);
        if (gotoEdge) targetId = gotoEdge.target;
      }
      chunk.termination_type = "goto";
      chunk.termination_node_id = currentNodeId;
      chunk.goto_target_node = targetId || null;

      if (!ctx.isPublished && targetId && !ctx.nodesMap.has(targetId)) {
        if (!chunk.structural_warnings) chunk.structural_warnings = [];
        const nodeLabel = currentNode.label || currentNode.name || currentNode.alias || currentNode.type;
        chunk.structural_warnings.push({
          category: "broken_goto_target",
          node_id: currentNodeId,
          message: WARNING_MESSAGES.broken_goto_target(nodeLabel, targetId),
        });
      }
      break;
    }

    if (currentNode.type === "add_to_campaign") {
      const resource = currentNode.resource || currentNode.data || {};
      chunk.cross_ref_campaign_id =
        resource.campaign_id || resource.campaignId || null;
      chunk.termination_type = "add_to_campaign";
      chunk.termination_node_id = currentNodeId;
      break;
    }

    const outEdges = ctx.adjacency.get(currentNodeId) || [];

    if (
      currentNode.type === "next" &&
      (outEdges.length === 0 ||
        !(currentNode.resource?.isValid ?? currentNode.data?.isValid ?? true))
    ) {
      chunk.termination_type = "unconfigured";
      chunk.termination_node_id = currentNodeId;
      break;
    }

    if (!ctx.isPublished && FORK_NODE_TYPES.has(currentNode.type) && outEdges.length === 1) {
      if (!chunk.structural_warnings) chunk.structural_warnings = [];
      const nodeLabel = currentNode.label || currentNode.name || currentNode.alias || currentNode.type;
      const existingLabel = getEdgeLabel(outEdges[0]) || "one";
      const missingDirection = existingLabel === "yes" ? "no" : existingLabel === "no" ? "yes" : "alternate";
      chunk.structural_warnings.push({
        category: "missing_branch",
        node_id: currentNodeId,
        message: WARNING_MESSAGES.missing_branch(nodeLabel, missingDirection),
      });
    }

    if (FORK_NODE_TYPES.has(currentNode.type) && outEdges.length > 1) {
      chunk.termination_type = "fork";
      chunk.termination_node_id = currentNodeId;
      chunk.is_fork_parent = true;
      chunk.fork_type = currentNode.type as ForkType;
      chunk.branches_are_concurrent = currentNode.type === "fork";

      if (currentNode.type === "split") {
        const splitTests = currentNode.resource?.splitTests;
        if (Array.isArray(splitTests)) {
          chunk.split_test_weights = splitTests.map((t: any) => ({
            id: String(t.id || ""),
            weight: String(t.weight || "0"),
          }));
        }
      }

      for (const edge of outEdges) {
        let label = getEdgeLabel(edge);
        if (!label) {
          const targetNode = ctx.nodesMap.get(edge.target);
          if (targetNode && (targetNode.type === "goal" || targetNode.type === "trigger")) {
            const nodeLabel = targetNode.label || targetNode.name || targetNode.alias || targetNode.type;
            label = `${targetNode.type}: ${nodeLabel}`;
          } else {
            label = `branch_${edge.id}`;
          }
        }
        const branchChunkId = walkChain(
          ctx,
          edge.target,
          "fork_branch",
          chunkId,
          label,
          _enrichmentCache,
          localPath,
        );
        if (branchChunkId) {
          chunk.sub_chunks.push(branchChunkId);

          let relType: RelationshipType = "fork_default";
          if (label === "yes") relType = "fork_yes";
          else if (label === "no") relType = "fork_no";

          ctx.relationships.push({
            from: chunkId,
            to: branchChunkId,
            type: relType,
            condition: label,
          });
        }
      }
      break;
    }

    if (outEdges.length === 0) {
      chunk.termination_type = "open_ended";
      chunk.termination_node_id = currentNodeId;
      break;
    }

    if (outEdges.length === 1) {
      currentNodeId = outEdges[0].target;
    } else if (
      currentNode.type === "wait" &&
      outEdges.some((e) => (e.type || "").toLowerCase() === "goal" || (e.sourceHandle || "").toLowerCase() === "goal") &&
      outEdges.some((e) => (e.type || "").toLowerCase() === "waitproceed" || (e.sourceHandle || "").toLowerCase().includes("proceed"))
    ) {
      chunk.termination_type = "fork";
      chunk.termination_node_id = currentNodeId;
      chunk.is_fork_parent = true;
      chunk.fork_type = "wait_goal";
      chunk.branches_are_concurrent = false;

      const goalEdge = outEdges.find((e) => (e.type || "").toLowerCase() === "goal" || (e.sourceHandle || "").toLowerCase() === "goal");
      const proceedEdge = outEdges.find((e) => (e.type || "").toLowerCase() === "waitproceed" || (e.sourceHandle || "").toLowerCase().includes("proceed"));

      if (goalEdge) {
        const goalTarget = ctx.nodesMap.get(goalEdge.target);
        const goalLabel = goalTarget ? (goalTarget.label || goalTarget.name || goalTarget.alias || "Goal") : "Goal";
        const branchChunkId = walkChain(
          ctx,
          goalEdge.target,
          "goal",
          chunkId,
          "goal_achieved",
          _enrichmentCache,
          localPath,
        );
        if (branchChunkId) {
          chunk.sub_chunks.push(branchChunkId);
          ctx.relationships.push({
            from: chunkId,
            to: branchChunkId,
            type: "wait_goal_achieved",
            condition: `goal: ${goalLabel}`,
          });
        }
      }

      if (proceedEdge) {
        const branchChunkId = walkChain(
          ctx,
          proceedEdge.target,
          "fork_branch",
          chunkId,
          "proceed_if_not_achieved",
          _enrichmentCache,
          localPath,
        );
        if (branchChunkId) {
          chunk.sub_chunks.push(branchChunkId);
          ctx.relationships.push({
            from: chunkId,
            to: branchChunkId,
            type: "wait_goal_proceed",
            condition: "continue if goal not achieved within timeframe",
          });
        }
      }
      break;
    } else {
      chunk.termination_type = "fork";
      chunk.termination_node_id = currentNodeId;
      chunk.is_fork_parent = true;
      chunk.fork_type = "condition";
      chunk.branches_are_concurrent = false;

      for (const edge of outEdges) {
        let label = getEdgeLabel(edge);
        if (!label) {
          const targetNode = ctx.nodesMap.get(edge.target);
          if (targetNode && (targetNode.type === "goal" || targetNode.type === "trigger")) {
            const nodeLabel = targetNode.label || targetNode.name || targetNode.alias || targetNode.type;
            label = `${targetNode.type}: ${nodeLabel}`;
          } else {
            label = `branch_${edge.id}`;
          }
        }
        const branchChunkId = walkChain(
          ctx,
          edge.target,
          "fork_branch",
          chunkId,
          label,
          _enrichmentCache,
          localPath,
        );
        if (branchChunkId) {
          chunk.sub_chunks.push(branchChunkId);

          let relType: RelationshipType = "fork_default";
          if (label === "yes") relType = "fork_yes";
          else if (label === "no") relType = "fork_no";

          ctx.relationships.push({
            from: chunkId,
            to: branchChunkId,
            type: relType,
            condition: label,
          });
        }
      }
      break;
    }
  }

  chunk.total_duration = cumulativeElapsed;
  ctx.chunks.push(chunk);

  if (
    chunk.trigger_goal_semantics &&
    chunk.entry_type === "trigger" &&
    chunk.trigger_goal_semantics.collision === "move"
  ) {
    ctx.relationships.push({
      from: chunkId,
      to: chunkId,
      type: "restart_on_retrigger",
      condition: `scope: ${chunk.trigger_goal_semantics.scope}`,
    });
  }

  if (
    chunk.trigger_goal_semantics?.is_convergence_point &&
    !ctx.emittedConvergence.has(chunkId)
  ) {
    ctx.emittedConvergence.add(chunkId);
    ctx.relationships.push({
      from: "*",
      to: chunkId,
      type: "convergence",
      condition: `scope: ${chunk.trigger_goal_semantics.scope}`,
    });
  }

  return chunkId;
}

const OVERSIZED_CHUNK_THRESHOLD = 20;

function findBestSplitIndex(nodes: string[], nodesMap: Map<string, OntraportNode>): number {
  let bestWait = -1;
  let bestTag = -1;
  let bestComm = -1;

  for (let i = Math.floor(nodes.length / 3); i < nodes.length - 2; i++) {
    const node = nodesMap.get(nodes[i]);
    if (!node) continue;
    const nType = node.type.toLowerCase();

    if (nType === "wait" && bestWait === -1) bestWait = i + 1;
    else if ((nType === "change_tags" || nType === "add_tag" || nType === "remove_tag") && bestTag === -1) bestTag = i + 1;
    else if ((nType === "send_email" || nType === "email" || nType === "send_sms" || nType === "sms") && bestComm === -1) bestComm = i + 1;
  }

  if (bestWait > 0) return bestWait;
  if (bestTag > 0) return bestTag;
  if (bestComm > 0) return bestComm;
  return Math.min(OVERSIZED_CHUNK_THRESHOLD, Math.floor(nodes.length / 2));
}

function segmentOversizedChunks(
  chunks: Chunk[],
  relationships: Relationship[],
  nodesMap: Map<string, OntraportNode>,
  chunkCounter: { value: number },
): { chunks: Chunk[]; relationships: Relationship[] } {
  const newChunks: Chunk[] = [];
  const newRelationships: Relationship[] = [...relationships];

  const queue: Chunk[] = [...chunks];
  const totalNodes = chunks.reduce((sum, c) => sum + c.nodes.length, 0);
  const MAX_ITERATIONS = Math.max(chunks.length * 20, totalNodes * 2);
  let iterations = 0;

  while (queue.length > 0) {
    if (++iterations > MAX_ITERATIONS) {
      newChunks.push(...queue);
      break;
    }
    const chunk = queue.shift()!;
    if (chunk.nodes.length <= OVERSIZED_CHUNK_THRESHOLD) {
      newChunks.push(chunk);
      continue;
    }

    const splitAt = findBestSplitIndex(chunk.nodes, nodesMap);
    if (splitAt <= 0 || splitAt >= chunk.nodes.length) {
      newChunks.push(chunk);
      continue;
    }

    const firstNodes = chunk.nodes.slice(0, splitAt);
    const firstDetails = chunk.node_details.slice(0, splitAt);
    const secondNodes = chunk.nodes.slice(splitAt);
    const secondDetails = chunk.node_details.slice(splitAt);

    chunkCounter.value++;
    const continuationId = `cont_${chunkCounter.value}`;

    const firstChunk: Chunk = {
      ...chunk,
      nodes: firstNodes,
      node_details: firstDetails,
      termination_type: "open_ended",
      termination_node_id: firstNodes[firstNodes.length - 1],
      sub_chunks: [],
      goto_target_node: null,
      cross_ref_campaign_id: null,
      is_fork_parent: false,
      fork_type: null,
      branches_are_concurrent: false,
      split_test_weights: null,
      total_duration: computeSegmentDuration(firstDetails),
    };

    const continuationChunk: Chunk = {
      id: continuationId,
      entry_type: "continuation",
      entry_node_id: secondNodes[0],
      nodes: secondNodes,
      termination_type: chunk.termination_type,
      termination_node_id: chunk.termination_node_id,
      sub_chunks: [],
      parent_chunk_id: chunk.parent_chunk_id,
      branch_label: null,
      goto_target_node: chunk.goto_target_node,
      cross_ref_campaign_id: chunk.cross_ref_campaign_id,
      trigger_goal_semantics: null,
      is_fork_parent: chunk.is_fork_parent,
      fork_type: chunk.fork_type,
      branches_are_concurrent: chunk.branches_are_concurrent,
      split_test_weights: chunk.split_test_weights,
      node_details: secondDetails,
      total_duration: computeSegmentDuration(secondDetails),
    };

    if (chunk.sub_chunks.length > 0) {
      continuationChunk.sub_chunks = chunk.sub_chunks;
      for (const subId of chunk.sub_chunks) {
        const subChunk = chunks.find(c => c.id === subId) || newChunks.find(c => c.id === subId);
        if (subChunk) {
          subChunk.parent_chunk_id = continuationId;
        }
      }
    }

    for (const rel of newRelationships) {
      if (rel.from === chunk.id) {
        rel.from = continuationId;
      }
    }

    newRelationships.push({
      from: firstChunk.id,
      to: continuationId,
      type: "continues_to",
      condition: null,
    });

    queue.unshift(continuationChunk);
    queue.unshift(firstChunk);
  }

  return { chunks: newChunks, relationships: newRelationships };
}

export function resolveGraph(
  campaignData: CampaignData,
  enrichmentCache: EnrichmentCache,
): { chunks: Chunk[]; relationships: Relationship[] } {
  const nodes = campaignData.nodes || [];
  const edges = campaignData.edges || [];

  const nodesMap = new Map<string, OntraportNode>();
  const adjacency = new Map<string, OntraportEdge[]>();
  const incomingEdges = new Map<string, OntraportEdge[]>();
  const gotoEdges = new Map<string, OntraportEdge>();

  for (const node of nodes) {
    if (!IGNORED_NODE_TYPES.has(node.type)) {
      nodesMap.set(node.id, node);
    }
  }

  for (const edge of edges) {
    if (!nodesMap.has(edge.source) || !nodesMap.has(edge.target)) continue;

    const edgeType = (edge.type || "").toLowerCase();
    const edgeHandle = (edge.sourceHandle || "").toLowerCase();
    const isGotoEdge = edgeType === "goto" || edgeHandle.includes("goto");

    if (isGotoEdge) {
      gotoEdges.set(edge.source, edge);
    } else {
      if (!adjacency.has(edge.source)) {
        adjacency.set(edge.source, []);
      }
      adjacency.get(edge.source)!.push(edge);
    }

    if (!incomingEdges.has(edge.target)) {
      incomingEdges.set(edge.target, []);
    }
    incomingEdges.get(edge.target)!.push(edge);
  }

  const isPublished = campaignData.isPublished !== false;
  const unconfiguredNodeIds = campaignData.unconfiguredNodeIds || new Set<string>();

  const ctx: GraphContext = {
    nodesMap,
    adjacency,
    incomingEdges,
    gotoEdges,
    chunks: [],
    relationships: [],
    chunkCounter: 0,
    emittedConvergence: new Set(),
    isPublished,
    unconfiguredNodeIds,
    visitedNodeIds: new Set(),
  };

  const triggerNodes = nodes.filter(
    (n) => n.type === "trigger" && !IGNORED_NODE_TYPES.has(n.type),
  );

  for (const trigger of triggerNodes) {
    const hasOutgoing = adjacency.has(trigger.id) && (adjacency.get(trigger.id)!.length > 0);
    if (!hasOutgoing && !isPublished) {
      ctx.visitedNodeIds.add(trigger.id);
      const detail = buildNodeDetail(trigger, zeroDuration());
      const triggerLabel = trigger.label || trigger.name || trigger.alias || trigger.type;
      const warnings: StructuralWarning[] = [{
        category: "dead_end_trigger",
        node_id: trigger.id,
        message: WARNING_MESSAGES.dead_end_trigger(triggerLabel),
      }];
      if (unconfiguredNodeIds.has(trigger.id)) {
        warnings.push({
          category: "unconfigured_node",
          node_id: trigger.id,
          message: WARNING_MESSAGES.unconfigured_node(triggerLabel, trigger.type),
        });
      }
      const chunk: Chunk = {
        id: nextChunkId(ctx, "trigger"),
        entry_type: "trigger" as EntryType,
        entry_node_id: trigger.id,
        nodes: [trigger.id],
        termination_type: "dead_end" as TerminationType,
        termination_node_id: trigger.id,
        sub_chunks: [],
        parent_chunk_id: null,
        branch_label: null,
        goto_target_node: null,
        cross_ref_campaign_id: null,
        trigger_goal_semantics: extractTriggerGoalSemantics(trigger),
        is_fork_parent: false,
        fork_type: null,
        branches_are_concurrent: false,
        split_test_weights: null,
        node_details: [detail],
        total_duration: zeroDuration(),
        structural_warnings: warnings,
      };
      ctx.chunks.push(chunk);
    } else {
      walkChain(ctx, trigger.id, "trigger", null, null, enrichmentCache);
    }
  }

  if (!isPublished) {
    const gotoTargetSeeds: string[] = [];
    for (const chunk of ctx.chunks) {
      if (chunk.goto_target_node && nodesMap.has(chunk.goto_target_node) && !ctx.visitedNodeIds.has(chunk.goto_target_node)) {
        gotoTargetSeeds.push(chunk.goto_target_node);
      }
    }
    const reachQueue = [...gotoTargetSeeds];
    while (reachQueue.length > 0) {
      const nodeId = reachQueue.shift()!;
      if (ctx.visitedNodeIds.has(nodeId)) continue;
      ctx.visitedNodeIds.add(nodeId);
      const outEdges = adjacency.get(nodeId) || [];
      for (const edge of outEdges) {
        if (!ctx.visitedNodeIds.has(edge.target)) {
          reachQueue.push(edge.target);
        }
      }
    }
    const orphanedIds = Array.from(nodesMap.keys()).filter(id => !ctx.visitedNodeIds.has(id));
    if (orphanedIds.length > 0) {
      const orphanDetailsList: NodeDetail[] = [];
      const orphanWarnings: StructuralWarning[] = [];
      for (const id of orphanedIds) {
        const node = nodesMap.get(id)!;
        orphanDetailsList.push(buildNodeDetail(node, zeroDuration()));
        const nodeLabel = node.label || node.name || node.alias || node.type;
        orphanWarnings.push({
          category: "orphaned_node",
          node_id: id,
          message: WARNING_MESSAGES.orphaned_node(nodeLabel, node.type),
        });
        if (unconfiguredNodeIds.has(id)) {
          orphanWarnings.push({
            category: "unconfigured_node",
            node_id: id,
            message: WARNING_MESSAGES.unconfigured_node(nodeLabel, node.type),
          });
        }
      }
      const orphanChunk: Chunk = {
        id: nextChunkId(ctx, "orphan"),
        entry_type: "orphan" as EntryType,
        entry_node_id: orphanedIds[0],
        nodes: orphanedIds,
        termination_type: "dead_end" as TerminationType,
        termination_node_id: null,
        sub_chunks: [],
        parent_chunk_id: null,
        branch_label: null,
        goto_target_node: null,
        cross_ref_campaign_id: null,
        trigger_goal_semantics: null,
        is_fork_parent: false,
        fork_type: null,
        branches_are_concurrent: false,
        split_test_weights: null,
        node_details: orphanDetailsList,
        total_duration: zeroDuration(),
        structural_warnings: orphanWarnings,
      };
      ctx.chunks.push(orphanChunk);
    }
  }

  const hasOversized = ctx.chunks.some(c => c.nodes.length > OVERSIZED_CHUNK_THRESHOLD);
  if (hasOversized) {
    const counter = { value: ctx.chunkCounter };
    const segmented = segmentOversizedChunks(ctx.chunks, ctx.relationships, ctx.nodesMap, counter);
    return segmented;
  }

  return {
    chunks: ctx.chunks,
    relationships: ctx.relationships,
  };
}
