import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api";

export function RunDashboard() {
  const { runId } = useParams<{ runId: string }>();
  const [run, setRun] = useState<any>(null);
  const [selectedResult, setSelectedResult] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<"intent" | "summary" | "details">("intent");

  useEffect(() => {
    if (runId) {
      api.runs.get(runId).then(setRun);
    }
  }, [runId]);

  useEffect(() => {
    if (run?.results?.length > 0 && !selectedResult) {
      setSelectedResult(run.results[0]);
    }
  }, [run]);

  if (!run) return <div className="text-gray-500">Loading...</div>;

  const tabs = [
    { key: "intent", label: "Intent" },
    { key: "summary", label: "Behavioral Summary" },
    { key: "details", label: "Node Details" },
  ] as const;

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{run.label || "Run"}</h1>
        <span className={`px-3 py-1 rounded text-sm ${run.status === "completed" ? "bg-green-100 text-green-800" : run.status === "running" ? "bg-yellow-100 text-yellow-800" : "bg-red-100 text-red-800"}`}>
          {run.status}
        </span>
      </div>

      <div className="grid grid-cols-[280px_1fr] gap-6">
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-2">Results</h2>
          {(run.results || []).map((r: any) => (
            <button
              key={r.id}
              onClick={() => setSelectedResult(r)}
              className={`w-full text-left rounded border p-3 text-sm ${selectedResult?.id === r.id ? "border-blue-500 bg-blue-50" : "bg-white hover:border-gray-400"}`}
            >
              <div className="font-medium truncate">Test Case</div>
              <div className="flex items-center gap-2 mt-1">
                <span className={`w-2 h-2 rounded-full ${r.status === "completed" ? "bg-green-500" : r.status === "running" ? "bg-yellow-500" : r.status === "failed" ? "bg-red-500" : "bg-gray-300"}`} />
                <span className="text-xs text-gray-500">{r.status}</span>
              </div>
            </button>
          ))}
        </div>

        <div className="bg-white rounded-lg border">
          {selectedResult ? (
            <div>
              <div className="border-b px-4">
                <div className="flex gap-1">
                  {tabs.map(t => (
                    <button
                      key={t.key}
                      onClick={() => setActiveTab(t.key)}
                      className={`px-4 py-3 text-sm font-medium border-b-2 ${activeTab === t.key ? "border-blue-500 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="p-6">
                {activeTab === "intent" && (
                  <div className="whitespace-pre-wrap text-sm text-gray-800">{selectedResult.intent || "No intent data"}</div>
                )}
                {activeTab === "summary" && (
                  <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: (selectedResult.behavioralSummary || "No summary data").replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n\n/g, '<br/><br/>') }} />
                )}
                {activeTab === "details" && (
                  <pre className="text-xs text-gray-700 overflow-auto">{JSON.stringify(selectedResult.nodeDetails, null, 2)}</pre>
                )}
              </div>
            </div>
          ) : (
            <div className="p-6 text-gray-500">Select a result to view</div>
          )}
        </div>
      </div>
    </div>
  );
}
