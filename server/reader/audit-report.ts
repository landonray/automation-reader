export interface AuditFindingEntry {
  category: string;
  severity: string;
  node_ids: string[];
  message: string;
  remediation: string;
  source: "live_detection" | "retroactive_scan" | "structural_warning";
}

export interface AuditSummary {
  health_score: number;
  finding_count: number;
  findings_by_severity: { critical: number; warning: number; info: number };
  top_critical_findings: Array<{ category: string; message: string; node_ids: string[] }>;
}

export interface AuditReportOutput {
  automationId: string;
  accountId: string;
  automationName: string | null;
  isPublished: boolean | null;
  healthScore: number;
  findings: AuditFindingEntry[];
  findingsBySeverity: { critical: number; warning: number; info: number };
  categoryClassification: {
    primary_category: string;
    primary_label: string;
    confidence: string;
    funnel_stage: string;
  } | null;
  structuralWarningCount: number;
  readerResultId: string;
  generatedAt: string;
}

export interface BatchAuditSummary {
  reports: AuditReportOutput[];
  crossAutomationInsights: {
    totalAutomations: number;
    avgHealthScore: number;
    mostCommonIssues: Array<{ category: string; count: number }>;
    highestSeverityFindings: AuditFindingEntry[];
    automationsWithCriticalFindings: number;
    automationsRankedByCritical: Array<{ automationId: string; automationName: string | null; criticalCount: number; healthScore: number }>;
  };
}

export function computeHealthScore(findings: AuditFindingEntry[]): number {
  let criticalCount = 0;
  let warningCount = 0;
  let infoCount = 0;

  for (const f of findings) {
    if (f.severity === "critical") criticalCount++;
    else if (f.severity === "warning") warningCount++;
    else infoCount++;
  }

  return Math.max(0, 100 - (criticalCount * 25) - (warningCount * 10) - (infoCount * 2));
}

export function normalizeNodeIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(String).filter(Boolean);
}

export function canonicalKey(category: string, severity: string, nodeIds: string[]): string {
  const sortedNodes = [...nodeIds].sort().join(",");
  return `${category}:${severity}:${sortedNodes}`;
}

export function buildAuditSummary(findings: AuditFindingEntry[]): AuditSummary {
  const bySeverity = {
    critical: findings.filter(f => f.severity === "critical").length,
    warning: findings.filter(f => f.severity === "warning").length,
    info: findings.filter(f => f.severity === "info").length,
  };

  const topCritical = findings
    .filter(f => f.severity === "critical")
    .slice(0, 3)
    .map(f => ({ category: f.category, message: f.message, node_ids: f.node_ids }));

  return {
    health_score: computeHealthScore(findings),
    finding_count: findings.length,
    findings_by_severity: bySeverity,
    top_critical_findings: topCritical,
  };
}
