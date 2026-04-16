export type WarningCategory =
  | "dead_end_trigger"
  | "unconfigured_node"
  | "broken_goto_target"
  | "unconfigured_goal"
  | "missing_branch"
  | "orphaned_node";

export interface StructuralWarning {
  category: WarningCategory;
  node_id: string | null;
  message: string;
}

export const WARNING_MESSAGES = {
  dead_end_trigger: (label: string) =>
    `Trigger "${label}" has no outgoing connections and leads nowhere.`,

  unconfigured_node: (label: string, nodeType: string) =>
    `The ${nodeType} node "${label}" is not fully configured (flagged by Ontraport's checklist).`,

  broken_goto_target: (label: string, targetId: string) =>
    `GoTo node "${label}" references a nonexistent target (node ${targetId}).`,

  unconfigured_goal: (label: string) =>
    `Goal "${label}" has no configured trigger events and cannot fire.`,

  missing_branch: (label: string, direction: string) =>
    `The ${direction} branch of "${label}" has no connected path.`,

  orphaned_node: (label: string, nodeType: string) =>
    `The ${nodeType} node "${label}" is not connected to any trigger path and will never execute.`,
} as const;

export interface PublicationStatus {
  isPublished: boolean;
  unconfiguredNodeIds: Set<string>;
}

export const DEFAULT_PUBLICATION_STATUS: PublicationStatus = {
  isPublished: true,
  unconfiguredNodeIds: new Set(),
};

export function extractPublicationStatus(rawData: any): PublicationStatus {
  let automationObj: any;
  if (rawData.data) {
    const inner = rawData.data;
    automationObj = Array.isArray(inner) && inner.length > 0 ? inner[0] : inner;
  } else {
    automationObj = rawData;
  }

  const pauseField = automationObj.pause;
  const isPublished = pauseField === undefined || pauseField === null || pauseField === "0" || pauseField === 0;

  const unconfiguredNodeIds = new Set<string>();

  let campaign: any = null;
  if (automationObj.campaign) {
    try {
      campaign = typeof automationObj.campaign === "string"
        ? JSON.parse(automationObj.campaign)
        : automationObj.campaign;
    } catch {
      campaign = null;
    }
  }

  const checklist =
    automationObj.campaign_editor_checklist ||
    campaign?.resource?.campaign_editor_checklist ||
    [];
  if (Array.isArray(checklist)) {
    for (const entry of checklist) {
      if (entry && entry.completed === false && typeof entry.label === "string") {
        const nodeIdMatches = entry.label.match(/data-nodeid="(\d+)"/g);
        if (nodeIdMatches) {
          for (const match of nodeIdMatches) {
            const idMatch = match.match(/data-nodeid="(\d+)"/);
            if (idMatch) {
              unconfiguredNodeIds.add(idMatch[1]);
            }
          }
        }
      }
    }
  }

  return { isPublished, unconfiguredNodeIds };
}
