import React, { useEffect, useState } from "react";
import { api } from "../api";

// Simple line-by-line diff algorithm
function diffLines(
  a: string,
  b: string
): Array<{ type: "same" | "added" | "removed"; text: string }> {
  const aLines = (a || "").split("\n");
  const bLines = (b || "").split("\n");
  const result: Array<{ type: "same" | "added" | "removed"; text: string }> = [];

  let ai = 0,
    bi = 0;
  while (ai < aLines.length || bi < bLines.length) {
    if (
      ai < aLines.length &&
      bi < bLines.length &&
      aLines[ai] === bLines[bi]
    ) {
      result.push({ type: "same", text: aLines[ai] });
      ai++;
      bi++;
    } else if (
      bi < bLines.length &&
      (ai >= aLines.length || !aLines.slice(ai).includes(bLines[bi]))
    ) {
      result.push({ type: "added", text: bLines[bi] });
      bi++;
    } else {
      result.push({ type: "removed", text: aLines[ai] });
      ai++;
    }
  }
  return result;
}

interface DiffViewProps {
  baseText: string;
  compareText: string;
}

function DiffView({ baseText, compareText }: DiffViewProps) {
  const diff = diffLines(baseText, compareText);

  if (diff.length === 0) {
    return <p className="text-gray-400 italic text-sm">No content</p>;
  }

  return (
    <div className="font-mono text-sm leading-relaxed">
      {diff.map((line, i) => (
        <div
          key={i}
          className={
            line.type === "added"
              ? "bg-green-50 text-green-900 px-2 py-0.5"
              : line.type === "removed"
              ? "bg-red-50 text-red-900 px-2 py-0.5 line-through"
              : "px-2 py-0.5 text-gray-700"
          }
        >
          {line.type === "added" ? (
            <span className="mr-1 text-green-500 select-none">+</span>
          ) : line.type === "removed" ? (
            <span className="mr-1 text-red-400 select-none">−</span>
          ) : (
            <span className="mr-1 text-gray-300 select-none"> </span>
          )}
          {line.text || <span className="text-gray-300">&nbsp;</span>}
        </div>
      ))}
    </div>
  );
}

interface RunComparisonProps {
  baseRun: any; // the "current" run (already loaded with results)
  suiteId: string;
  onExit: () => void;
}

export function RunComparison({ baseRun, suiteId, onExit }: RunComparisonProps) {
  const [allRuns, setAllRuns] = useState<any[]>([]);
  const [compareRunId, setCompareRunId] = useState<string>("");
  const [compareRun, setCompareRun] = useState<any>(null);
  const [loadingCompare, setLoadingCompare] = useState(false);
  const [field, setField] = useState<"behavioralSummary" | "intent" | "nodeDetails">("behavioralSummary");

  // Load all runs for this suite so the user can pick one to compare against
  useEffect(() => {
    api.runs.list(suiteId).then((rows) => {
      // Exclude the current run from the list
      setAllRuns(rows.filter((r) => r.id !== baseRun.id));
    });
  }, [suiteId, baseRun.id]);

  // When the user picks a comparison run, fetch its full data
  useEffect(() => {
    if (!compareRunId) {
      setCompareRun(null);
      return;
    }
    setLoadingCompare(true);
    api.runs.get(compareRunId).then((data) => {
      setCompareRun(data);
      setLoadingCompare(false);
    });
  }, [compareRunId]);

  // Build a map of testCaseId → result for each run so we can pair them up
  const baseByTestCase: Record<string, any> = {};
  for (const r of baseRun.results || []) {
    if (r.testCaseId) baseByTestCase[r.testCaseId] = r;
  }

  const compareByTestCase: Record<string, any> = {};
  if (compareRun) {
    for (const r of compareRun.results || []) {
      if (r.testCaseId) compareByTestCase[r.testCaseId] = r;
    }
  }

  // All testCaseIds that appear in at least one run
  const allTestCaseIds = Array.from(
    new Set([
      ...Object.keys(baseByTestCase),
      ...Object.keys(compareByTestCase),
    ])
  );

  const fieldLabel = field === "behavioralSummary" ? "Behavioral Summary" : field === "intent" ? "Intent" : "Node Details";

  function nodeDetailsToText(details: any): string {
    if (!Array.isArray(details) || details.length === 0) return "(no node details)";
    return details.map((layer: any) => {
      const heading = layer.chunk_narration || layer.chunk_id || "";
      const nodes = (layer.nodes || []).map((n: any) =>
        `  ${n.label || n.id}: ${n.resolved_description || n.type || "-"}`
      ).join("\n");
      return heading + "\n" + nodes;
    }).join("\n\n");
  }

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex items-center justify-between bg-white border rounded-lg px-5 py-3">
        <div className="flex items-center gap-4">
          <h2 className="font-semibold text-gray-900">Compare Runs</h2>

          {/* Compare-to selector */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">Compare to:</span>
            <select
              className="border rounded px-2 py-1 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-300"
              value={compareRunId}
              onChange={(e) => setCompareRunId(e.target.value)}
            >
              <option value="">— pick a run —</option>
              {allRuns.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label || r.id.slice(0, 8)} —{" "}
                  {r.startedAt ? new Date(r.startedAt).toLocaleString() : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Field toggle */}
          {compareRun && (
            <div className="flex items-center gap-1 border rounded overflow-hidden text-sm">
              <button
                onClick={() => setField("behavioralSummary")}
                className={`px-3 py-1 ${
                  field === "behavioralSummary"
                    ? "bg-blue-600 text-white"
                    : "bg-white text-gray-600 hover:bg-gray-50"
                }`}
              >
                Behavioral Summary
              </button>
              <button
                onClick={() => setField("intent")}
                className={`px-3 py-1 ${
                  field === "intent"
                    ? "bg-blue-600 text-white"
                    : "bg-white text-gray-600 hover:bg-gray-50"
                }`}
              >
                Intent
              </button>
              <button
                onClick={() => setField("nodeDetails")}
                className={`px-3 py-1 ${
                  field === "nodeDetails"
                    ? "bg-blue-600 text-white"
                    : "bg-white text-gray-600 hover:bg-gray-50"
                }`}
              >
                Node Details
              </button>
            </div>
          )}
        </div>

        <button
          onClick={onExit}
          className="text-sm text-gray-500 hover:text-gray-800 border rounded px-3 py-1"
        >
          Exit Compare
        </button>
      </div>

      {/* No run selected yet */}
      {!compareRunId && (
        <div className="bg-white rounded-lg border p-6 text-gray-400 text-center">
          Select a run above to start comparing.
        </div>
      )}

      {/* Loading */}
      {compareRunId && loadingCompare && (
        <div className="bg-white rounded-lg border p-6 text-gray-400 text-center">
          Loading comparison run…
        </div>
      )}

      {/* Side-by-side comparisons */}
      {compareRun && !loadingCompare && (
        <>
          {/* Column headers */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-blue-50 border border-blue-200 rounded px-4 py-2 text-sm font-semibold text-blue-800">
              Current run: {baseRun.label || baseRun.id.slice(0, 8)}
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded px-4 py-2 text-sm font-semibold text-gray-700">
              Compare to: {compareRun.label || compareRun.id.slice(0, 8)}
            </div>
          </div>

          {allTestCaseIds.length === 0 && (
            <div className="bg-white rounded-lg border p-6 text-gray-400 text-center">
              No automations found in either run.
            </div>
          )}

          {allTestCaseIds.map((tcId) => {
            const base = baseByTestCase[tcId];
            const compare = compareByTestCase[tcId];
            const name =
              base?.automationName || compare?.automationName || tcId;

            const baseText = base
              ? field === "nodeDetails"
                ? nodeDetailsToText(base.nodeDetails)
                : base[field] || ""
              : "";
            const compareText = compare
              ? field === "nodeDetails"
                ? nodeDetailsToText(compare.nodeDetails)
                : compare[field] || ""
              : "";

            return (
              <div key={tcId} className="bg-white rounded-lg border overflow-hidden">
                {/* Automation name */}
                <div className="bg-gray-50 border-b px-4 py-2 text-sm font-medium text-gray-700">
                  {name} — <span className="text-gray-400">{fieldLabel}</span>
                </div>

                <div className="grid grid-cols-2 divide-x">
                  {/* Base run column */}
                  <div className="p-4 overflow-auto max-h-96">
                    {base ? (
                      <DiffView baseText={baseText} compareText={compareText} />
                    ) : (
                      <p className="text-gray-400 italic text-sm">
                        Not present in this run
                      </p>
                    )}
                  </div>

                  {/* Compare run column */}
                  <div className="p-4 overflow-auto max-h-96">
                    {compare ? (
                      <DiffView baseText={compareText} compareText={baseText} />
                    ) : (
                      <p className="text-gray-400 italic text-sm">
                        Not present in this run
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
