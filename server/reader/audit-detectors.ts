import type { Chunk, Relationship } from "./types.js";

export type AuditSeverity = "info" | "warning" | "critical";

export type AuditCategory =
  | "goto_cycle"
  | "zero_duration_wait"
  | "duplicate_sequential_actions"
  | "identical_condition_branches"
  | "empty_fork_branch"
  | "tag_flipflop"
  | "oversized_automation"
  | "excessive_nesting"
  | "orphaned_segment"
  | "missing_webhook_error_handling";

export interface AuditFinding {
  category: AuditCategory;
  severity: AuditSeverity;
  node_ids: string[];
  message: string;
  remediation: string;
}

export type DetectorFn = (
  chunks: Chunk[],
  relationships: Relationship[],
  context?: DetectorContext,
) => AuditFinding[];

export interface DetectorContext {
  isPublished: boolean;
}

export interface DetectorManifestEntry {
  id: AuditCategory;
  fn: DetectorFn;
  defaultSeverity: AuditSeverity;
  description: string;
}

export function detectGotoCycles(
  chunks: Chunk[],
  _relationships: Relationship[],
): AuditFinding[] {
  const findings: AuditFinding[] = [];

  const chunkMap = new Map<string, Chunk>();
  for (const c of chunks) chunkMap.set(c.id, c);

  const gotoChunks = chunks.filter(
    c => c.termination_type === "goto" && c.goto_target_node,
  );

  for (const gotoChunk of gotoChunks) {
    const targetNodeId = gotoChunk.goto_target_node!;

    const targetChunk = chunks.find(
      c => c.nodes.includes(targetNodeId) || c.entry_node_id === targetNodeId,
    );
    if (!targetChunk) continue;

    const isAncestor = (candidateId: string, descendantId: string): boolean => {
      const visited = new Set<string>();
      const queue = [descendantId];
      while (queue.length > 0) {
        const current = queue.shift()!;
        if (visited.has(current)) continue;
        visited.add(current);
        const chunk = chunkMap.get(current);
        if (!chunk) continue;
        if (chunk.parent_chunk_id) {
          if (chunk.parent_chunk_id === candidateId) return true;
          queue.push(chunk.parent_chunk_id);
        }
      }
      return false;
    };

    if (
      targetChunk.id === gotoChunk.id ||
      isAncestor(targetChunk.id, gotoChunk.id)
    ) {
      const gotoNodeId = gotoChunk.termination_node_id || gotoChunk.nodes[gotoChunk.nodes.length - 1];
      const nodeIds = gotoNodeId ? [gotoNodeId, targetNodeId] : [targetNodeId];
      findings.push({
        category: "goto_cycle",
        severity: "critical",
        node_ids: nodeIds,
        message: `GoTo node creates a cycle: chunk "${gotoChunk.id}" routes back to an ancestor chunk "${targetChunk.id}" (node ${targetNodeId}), which can cause contacts to loop indefinitely.`,
        remediation: "Add a condition or counter mechanism to break the loop, or redirect the GoTo to a downstream node instead of an upstream one.",
      });
    }
  }

  return findings;
}

export function detectZeroDurationWaits(
  chunks: Chunk[],
  _relationships: Relationship[],
): AuditFinding[] {
  const findings: AuditFinding[] = [];

  const SKIP_WAIT_TYPES = new Set([
    "forever", "before_after_date", "arrive_date", "day_of_week",
  ]);

  for (const chunk of chunks) {
    const isGoalWaitChunk = chunk.fork_type === "wait_goal" ||
      chunk.termination_type === "waiting_for_goal";

    for (const nd of chunk.node_details) {
      if (nd.type !== "wait") continue;

      const res = nd.resource || {};
      const waitType = res.wait_type || "";

      if (SKIP_WAIT_TYPES.has(waitType)) continue;

      if (!waitType || waitType === "delay" || waitType === "time") {
        if (isGoalWaitChunk) continue;

        const hasGoalCondition = res.goal_condition || res.goal_id || res.goal_type;
        if (hasGoalCondition) continue;
      }

      const days = parseInt(res.time_days || "0", 10) || 0;
      const hours = parseInt(res.time_hours || "0", 10) || 0;
      const minutes = parseInt(res.time_minutes || "0", 10) || 0;
      const value = parseInt(res.wait_value || res.value || "0", 10) || 0;
      const hasTod = res.wait_till_tod === "1" || res.wait_till_tod === 1;

      if (days === 0 && hours === 0 && minutes === 0 && value === 0 && !hasTod) {
        findings.push({
          category: "zero_duration_wait",
          severity: "warning",
          node_ids: [nd.id],
          message: `Wait node "${nd.label}" (node ${nd.id}) has zero duration and no time-of-day constraint. Contacts pass through immediately, making this wait step effectively a no-op.`,
          remediation: "Set a meaningful wait duration, add a time-of-day constraint, or remove the wait node if the delay is not needed.",
        });
      }
    }
  }

  return findings;
}

export function detectDuplicateSequentialActions(
  chunks: Chunk[],
  _relationships: Relationship[],
): AuditFinding[] {
  const findings: AuditFinding[] = [];

  const ACTION_TYPES = new Set([
    "send_email", "email", "email_notify", "sms", "send_sms",
    "change_tags", "add_tag", "remove_tag",
    "change_field", "update_field",
    "webhook", "add_to_campaign", "remove_from_campaign",
    "assign_task", "create_task",
  ]);

  for (const chunk of chunks) {
    const details = chunk.node_details;
    for (let i = 0; i < details.length - 1; i++) {
      const current = details[i];
      const next = details[i + 1];

      if (!ACTION_TYPES.has(current.type) || current.type !== next.type) continue;

      const curRes = current.resource || {};
      const nextRes = next.resource || {};

      let isDuplicate = false;

      if ((current.type === "send_email" || current.type === "email") &&
          curRes.object_id && curRes.object_id === nextRes.object_id) {
        isDuplicate = true;
      } else if ((current.type === "add_tag" || current.type === "remove_tag") &&
                 curRes.tag_id && curRes.tag_id === nextRes.tag_id) {
        isDuplicate = true;
      } else if (current.type === "change_tags" &&
                 curRes.tag_selector && nextRes.tag_selector) {
        const extractTagValues = (list: unknown): string[] => {
          if (!Array.isArray(list)) return [];
          return list.map((t: Record<string, unknown>) => String(t.value || ""));
        };
        const curTags = extractTagValues(curRes.tag_selector.list).sort().join(",");
        const nextTags = extractTagValues(nextRes.tag_selector.list).sort().join(",");
        const curAction = curRes.tag_selector.sub_unsub;
        const nextAction = nextRes.tag_selector.sub_unsub;
        if (curTags === nextTags && curAction === nextAction && curTags.length > 0) {
          isDuplicate = true;
        }
      } else if ((current.type === "change_field" || current.type === "update_field") &&
                 curRes.update_contact_field && curRes.update_contact_field === nextRes.update_contact_field &&
                 curRes.update_contact_val === nextRes.update_contact_val) {
        isDuplicate = true;
      }

      if (isDuplicate) {
        findings.push({
          category: "duplicate_sequential_actions",
          severity: "info",
          node_ids: [current.id, next.id],
          message: `Two consecutive ${current.type} nodes ("${current.label}" and "${next.label}") perform the same action with the same target. The second node is redundant.`,
          remediation: "Remove the duplicate node or verify that both are intentionally needed (e.g., different send times via a wait between them).",
        });
      }
    }
  }

  return findings;
}

export function detectIdenticalConditionBranches(
  chunks: Chunk[],
  _relationships: Relationship[],
): AuditFinding[] {
  const findings: AuditFinding[] = [];

  const forkChunks = chunks.filter(
    c => c.is_fork_parent && c.fork_type === "condition" && c.sub_chunks.length === 2,
  );

  const chunkMap = new Map<string, Chunk>();
  for (const c of chunks) chunkMap.set(c.id, c);

  const getDeepSignature = (chunkId: string, visited: Set<string>): string => {
    if (visited.has(chunkId)) return "";
    visited.add(chunkId);
    const c = chunkMap.get(chunkId);
    if (!c) return "";

    const nodeSig = c.node_details
      .map(nd => {
        const res = nd.resource || {};
        return [
          nd.type,
          res.object_id || "",
          res.tag_id || "",
          res.update_contact_field || "",
          res.update_contact_val || "",
          res.campaign_id || "",
        ].join(":");
      })
      .join("|");

    const subSigs = c.sub_chunks
      .map(subId => getDeepSignature(subId, visited))
      .join("~");

    return subSigs ? `${nodeSig}>{${subSigs}}` : nodeSig;
  };

  for (const fork of forkChunks) {
    const branch1 = chunkMap.get(fork.sub_chunks[0]);
    const branch2 = chunkMap.get(fork.sub_chunks[1]);
    if (!branch1 || !branch2) continue;

    const sig1 = getDeepSignature(fork.sub_chunks[0], new Set());
    const sig2 = getDeepSignature(fork.sub_chunks[1], new Set());

    if (sig1 === sig2 && sig1.length > 0 && branch1.node_details.length > 0) {
      const conditionNodeId = fork.termination_node_id || fork.nodes[fork.nodes.length - 1];
      findings.push({
        category: "identical_condition_branches",
        severity: "warning",
        node_ids: conditionNodeId ? [conditionNodeId] : [],
        message: `Condition node "${fork.node_details[fork.node_details.length - 1]?.label || "unknown"}" (node ${conditionNodeId}) has both branches performing identical actions across all sub-branches. The condition check has no practical effect.`,
        remediation: "Differentiate the branch actions, or remove the condition and keep only one branch if both outcomes should be the same.",
      });
    }
  }

  return findings;
}

export function detectEmptyForkBranches(
  chunks: Chunk[],
  _relationships: Relationship[],
  context?: DetectorContext,
): AuditFinding[] {
  if (context && !context.isPublished) return [];

  const findings: AuditFinding[] = [];

  const chunkMap = new Map<string, Chunk>();
  for (const c of chunks) chunkMap.set(c.id, c);

  const forkChunks = chunks.filter(
    c => c.is_fork_parent && c.sub_chunks.length > 0,
  );

  for (const fork of forkChunks) {
    for (const subId of fork.sub_chunks) {
      const sub = chunkMap.get(subId);
      if (!sub) continue;

      if (sub.node_details.length === 0 && sub.sub_chunks.length === 0) {
        const forkNodeId = fork.termination_node_id || fork.nodes[fork.nodes.length - 1];
        const branchLabel = sub.branch_label || "unknown";
        findings.push({
          category: "empty_fork_branch",
          severity: "info",
          node_ids: forkNodeId ? [forkNodeId] : [],
          message: `The "${branchLabel}" branch of "${fork.node_details[fork.node_details.length - 1]?.label || "fork"}" (node ${forkNodeId}) is empty — contacts entering this branch receive no actions.`,
          remediation: "Add actions to the empty branch, or document that the empty path is intentional (e.g., a 'do nothing' condition branch).",
        });
      }
    }
  }

  return findings;
}

export const DETECTOR_MANIFEST: DetectorManifestEntry[] = [
  {
    id: "goto_cycle",
    fn: detectGotoCycles,
    defaultSeverity: "critical",
    description: "Detects GoTo nodes that route back to ancestor chunks, creating infinite loops.",
  },
  {
    id: "zero_duration_wait",
    fn: detectZeroDurationWaits,
    defaultSeverity: "warning",
    description: "Detects wait nodes with zero duration and no time-of-day constraint.",
  },
  {
    id: "duplicate_sequential_actions",
    fn: detectDuplicateSequentialActions,
    defaultSeverity: "info",
    description: "Detects consecutive nodes of the same type performing identical actions.",
  },
  {
    id: "identical_condition_branches",
    fn: detectIdenticalConditionBranches,
    defaultSeverity: "warning",
    description: "Detects condition forks where both branches perform identical actions.",
  },
  {
    id: "empty_fork_branch",
    fn: detectEmptyForkBranches,
    defaultSeverity: "info",
    description: "Detects fork branches that contain no actions.",
  },
];

export function runAllDetectors(
  chunks: Chunk[],
  relationships: Relationship[],
  context?: DetectorContext,
): AuditFinding[] {
  const findings: AuditFinding[] = [];
  for (const entry of DETECTOR_MANIFEST) {
    findings.push(...entry.fn(chunks, relationships, context));
  }
  return findings;
}
