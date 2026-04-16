import React from "react";

interface Result {
  id: string;
  status: string;
  timing?: any;
  narratorLlmCalls?: number;
  synthesizerLlmCalls?: number;
  narratorDeterministicCalls?: number;
  errorMessage?: string;
  testCase?: { automationName?: string };
  automationName?: string;
  validation?: {
    passed: boolean;
    issues: Array<{ severity: string; rule: string; message: string }>;
  };
}

interface Props {
  results: Result[];
  selectedId: string | null;
  onSelect: (result: Result) => void;
}

const statusColors: Record<string, { dot: string; badge: string }> = {
  pending: { dot: "bg-gray-300", badge: "bg-gray-100 text-gray-600" },
  running: { dot: "bg-yellow-500", badge: "bg-yellow-100 text-yellow-700" },
  completed: { dot: "bg-green-500", badge: "bg-green-100 text-green-700" },
  failed: { dot: "bg-red-500", badge: "bg-red-100 text-red-700" },
};

export function ResultsList({ results, selectedId, onSelect }: Props) {
  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-2">
        Results ({results.length})
      </h2>
      {results.map((r) => {
        const colors = statusColors[r.status] || statusColors.pending;
        const name = r.automationName || r.testCase?.automationName || "Test Case";
        const totalTime = r.timing?.total;
        const llmCalls = (r.narratorLlmCalls || 0) + (r.synthesizerLlmCalls || 0);

        return (
          <button
            key={r.id}
            onClick={() => onSelect(r)}
            className={`w-full text-left rounded border p-3 text-sm transition-colors ${
              selectedId === r.id
                ? "border-blue-500 bg-blue-50"
                : "bg-white hover:border-gray-400"
            }`}
          >
            <div className="font-medium truncate">{name}</div>
            <div className="flex items-center gap-2 mt-1">
              <span className={`w-2 h-2 rounded-full ${colors.dot}`} />
              <span className={`text-xs px-1.5 py-0.5 rounded ${colors.badge}`}>
                {r.status}
              </span>
            </div>
            {r.status === "completed" && (
              <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-500">
                {totalTime != null && <span>{(totalTime / 1000).toFixed(1)}s</span>}
                {llmCalls > 0 && <span>{llmCalls} LLM calls</span>}
                {r.validation && (
                  r.validation.passed ? (
                    <span className="inline-flex items-center gap-1 text-green-600">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                      Valid
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-yellow-600">
                      <span className="w-1.5 h-1.5 rounded-full bg-yellow-500" />
                      {r.validation.issues.filter(i => i.severity === "error").length}e / {r.validation.issues.filter(i => i.severity === "warning").length}w
                    </span>
                  )
                )}
              </div>
            )}
            {r.status === "failed" && r.errorMessage && (
              <div className="mt-1.5 text-xs text-red-600 truncate">
                {r.errorMessage}
              </div>
            )}
          </button>
        );
      })}
      {results.length === 0 && (
        <div className="text-sm text-gray-400 py-4 text-center">No results yet</div>
      )}
    </div>
  );
}
