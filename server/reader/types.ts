export interface Duration {
  days: number;
  hours: number;
  minutes: number;
}

export interface TriggerGoalSemantics {
  scope: "account" | "campaign" | "wait_above";
  collision: "move" | "add_again" | "ignore";
  is_convergence_point: boolean;
  is_clone_point: boolean;
  events: Array<{ type: string; config: Record<string, any> }>;
}

export interface NodeDetail {
  id: string;
  type: string;
  label: string;
  resource: Record<string, any>;
  cumulative_elapsed: Duration;
}

export type TerminationType =
  | "end"
  | "exit"
  | "fork"
  | "waiting_for_goal"
  | "goto"
  | "add_to_campaign"
  | "unconfigured"
  | "open_ended"
  | "dead_end";

export type EntryType = "trigger" | "goal" | "fork_branch" | "continuation" | "orphan";

export type ForkType = "condition" | "split" | "fork" | "wait_goal";

export interface ChunkNarration {
  prose: string;
  entities_mentioned: string[];
  wait_description?: string;
  end_mode?: "end" | "exit" | "move_to_automation";
  end_target?: string;
  goto_target_description?: string;
  condition_description?: string;
  is_deterministic: boolean;
}

export interface Chunk {
  id: string;
  entry_type: EntryType;
  entry_node_id: string;
  nodes: string[];
  termination_type: TerminationType;
  termination_node_id: string | null;
  sub_chunks: string[];
  parent_chunk_id: string | null;
  branch_label: string | null;
  goto_target_node: string | null;
  cross_ref_campaign_id: string | null;
  trigger_goal_semantics: TriggerGoalSemantics | null;
  is_fork_parent: boolean;
  fork_type: ForkType | null;
  branches_are_concurrent: boolean;
  split_test_weights: Array<{ id: string; weight: string }> | null;
  node_details: NodeDetail[];
  total_duration: Duration;
  narration?: string;
  chunk_narration?: ChunkNarration;
  structural_warnings?: import("./structural-warnings").StructuralWarning[];
}

export type RelationshipType =
  | "restart_on_retrigger"
  | "convergence"
  | "goal_reached"
  | "goal_convergence"
  | "fork_default"
  | "fork_yes"
  | "fork_no"
  | "wait_goal_achieved"
  | "wait_goal_proceed"
  | "potential_merge"
  | "continues_to";

export interface Relationship {
  from: string;
  to: string;
  type: RelationshipType;
  condition: string | null;
}

export interface GotoConvergence {
  is_convergent: boolean;
  primary_target_node_id: string | null;
  target_node_description: string | null;
  convergence_ratio: number;
}

export interface EnrichmentCache {
  fields: Record<string, string>;
  field_values: Record<string, string>;
  messages: Record<string, { subject: string; body_summary: string }>;
  campaigns: Record<string, string>;
  products: Record<string, { name: string; price: string }>;
  forms: Record<string, string>;
  tags: Record<string, string>;
  landing_pages: Record<string, string>;
  webhook_urls: Record<string, string>;
  tasks: Record<string, string>;
  goto_convergence?: GotoConvergence;
}

export interface NodeDetailLayer {
  chunk_id: string;
  chunk_narration: string;
  nodes: Array<{
    id: string;
    type: string;
    label: string;
    resolved_description: string;
    timing: Duration | null;
  }>;
}

export interface SemanticLayers {
  intent: string;
  behavioral_summary: string;
  node_details: NodeDetailLayer[];
}

export interface ReaderValidationIssue {
  rule: string;
  severity: "error" | "warning";
  message: string;
  details?: string;
}

export interface ReaderValidationReport {
  passed: boolean;
  issues: ReaderValidationIssue[];
  retried: boolean;
  retryStages?: ("narration" | "synthesis")[];
}

export interface ReaderResult {
  chunks: Chunk[];
  relationships: Relationship[];
  layers: SemanticLayers;
  timing: {
    enrichment_ms: number;
    chunking_ms: number;
    narration_ms: number;
    synthesis_ms: number;
    classification_ms?: number;
    total_ms: number;
  };
  validation?: ReaderValidationReport;
  llmStats?: {
    narratorLlmCalls: number;
    narratorDeterministicCalls: number;
    narratorTruncationRetries?: number;
    synthesizerLlmCalls: number;
  };
  isPublished?: boolean;
  structural_warnings?: import("./structural-warnings").StructuralWarning[];
  audit_findings?: import("./audit-detectors").AuditFinding[];
}

export interface OntraportNode {
  id: string;
  type: string;
  label?: string;
  name?: string;
  alias?: string;
  description?: string;
  object_type_name?: string;
  resource?: Record<string, any>;
  data?: Record<string, any>;
  position?: { x: number; y: number };
  measured?: any;
  events?: any[];
  conditions?: any[];
  filter_conditions?: any[];
  inSplitBranch?: boolean;
  waitProceedNode?: string;
}

export interface OntraportEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  type?: string;
  data?: Record<string, any>;
}

export interface CampaignData {
  nodes: OntraportNode[];
  edges: OntraportEdge[];
  isPublished?: boolean;
  unconfiguredNodeIds?: Set<string>;
  rawAutomationData?: any;
}
