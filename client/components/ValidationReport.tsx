import React, { useState } from "react";

interface ValidationIssue {
  severity: string;
  rule?: string;
  message: string;
  details?: string;
}

interface ValidationData {
  passed?: boolean;
  issues?: ValidationIssue[];
}

interface Props {
  validation: ValidationData | null;
}

const severityColors: Record<string, string> = {
  error: "bg-red-100 text-red-700",
  warning: "bg-yellow-100 text-yellow-700",
  info: "bg-blue-100 text-blue-700",
};

export function ValidationReport({ validation }: Props) {
  const [expanded, setExpanded] = useState(false);

  if (!validation) return null;

  const issues = validation.issues || [];
  const passed = validation.passed !== false && issues.filter((i) => i.severity === "error").length === 0;

  return (
    <div className="border rounded">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        <div className="flex items-center gap-2">
          <span>Validation</span>
          <span
            className={`px-2 py-0.5 rounded text-xs font-medium ${
              passed ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
            }`}
          >
            {passed ? "PASS" : "FAIL"}
          </span>
          {issues.length > 0 && (
            <span className="text-xs text-gray-500">({issues.length} issues)</span>
          )}
        </div>
        <span className="text-gray-400">{expanded ? "\u2212" : "+"}</span>
      </button>

      {expanded && (
        <div className="border-t px-4 py-3">
          {issues.length === 0 ? (
            <div className="text-sm text-green-600">No issues found</div>
          ) : (
            <div className="space-y-2">
              {issues.map((issue, i) => (
                <div key={i} className="flex items-start gap-2 text-sm">
                  <span
                    className={`px-1.5 py-0.5 rounded text-xs font-medium shrink-0 mt-0.5 ${
                      severityColors[issue.severity] || severityColors.info
                    }`}
                  >
                    {issue.severity}
                  </span>
                  <div>
                    {issue.rule && (
                      <span className="font-mono text-xs text-gray-500 mr-2">{issue.rule}</span>
                    )}
                    <span className="text-gray-800">{issue.message}</span>
                    {issue.details && (
                      <div className="text-xs text-gray-500 mt-0.5">{issue.details}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
