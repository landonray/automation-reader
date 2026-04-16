import React, { useEffect, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api";
import { useSSE } from "../hooks/useSSE";
import { ResultsList } from "../components/ResultsList";
import { OutputTabs } from "../components/OutputTabs";
import { NotesPanel } from "../components/NotesPanel";
import { ValidationReport } from "../components/ValidationReport";
import { PipelineStats } from "../components/PipelineStats";
import { LlmCallLog } from "../components/LlmCallLog";

export function RunDashboard() {
  const { runId } = useParams<{ runId: string }>();
  const [run, setRun] = useState<any>(null);
  const [selectedResultId, setSelectedResultId] = useState<string | null>(null);
  const [fullResult, setFullResult] = useState<any>(null);
  const [loadingResult, setLoadingResult] = useState(false);

  // SSE for live progress — only connect when run is active
  const sseUrl = run?.status === "running" && runId ? `/api/runs/${runId}/stream` : null;
  const events = useSSE(sseUrl);

  // Load run data
  const loadRun = useCallback(async () => {
    if (!runId) return;
    const data = await api.runs.get(runId);
    setRun(data);
  }, [runId]);

  useEffect(() => {
    loadRun();
  }, [loadRun]);

  // React to SSE events — refresh run data when results change
  useEffect(() => {
    if (events.length === 0) return;
    const latest = events[events.length - 1];
    // Refresh run on any event
    loadRun();
    // If the selected result was updated, refresh its full details
    if (
      (latest.type === "result_completed" || latest.type === "result_failed") &&
      latest.data?.resultId === selectedResultId
    ) {
      loadFullResult(selectedResultId);
    }
  }, [events.length]);

  // Auto-select first result when run loads
  useEffect(() => {
    if (run?.results?.length > 0 && !selectedResultId) {
      setSelectedResultId(run.results[0].id);
    }
  }, [run]);

  // Load full result details when selection changes
  async function loadFullResult(resultId: string | null) {
    if (!resultId || !runId) {
      setFullResult(null);
      return;
    }
    setLoadingResult(true);
    try {
      const data = await api.runs.getResult(runId, resultId);
      setFullResult(data);
    } catch {
      setFullResult(null);
    }
    setLoadingResult(false);
  }

  useEffect(() => {
    loadFullResult(selectedResultId);
  }, [selectedResultId, runId]);

  if (!run) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">Loading run...</div>
    );
  }

  const statusColor =
    run.status === "completed"
      ? "bg-green-100 text-green-800"
      : run.status === "running"
      ? "bg-yellow-100 text-yellow-800"
      : run.status === "failed"
      ? "bg-red-100 text-red-800"
      : "bg-gray-100 text-gray-600";

  return (
    <div className="max-w-7xl mx-auto">
      {/* Run info bar */}
      <div className="flex items-center justify-between mb-6 bg-white border rounded-lg px-5 py-3">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold text-gray-900">{run.label || "Run"}</h1>
          <span className={`px-3 py-1 rounded text-sm font-medium ${statusColor}`}>
            {run.status}
          </span>
        </div>
        <div className="flex items-center gap-4 text-sm text-gray-500">
          {run.createdAt && (
            <span>Started: {new Date(run.createdAt).toLocaleString()}</span>
          )}
          {run.completedAt && (
            <span>Completed: {new Date(run.completedAt).toLocaleString()}</span>
          )}
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-[280px_1fr] gap-6">
        {/* Left: Results list */}
        <div>
          <ResultsList
            results={run.results || []}
            selectedId={selectedResultId}
            onSelect={(r) => setSelectedResultId(r.id)}
          />
        </div>

        {/* Right: Detail area */}
        <div className="space-y-4">
          {selectedResultId && fullResult ? (
            <>
              {/* Output tabs */}
              <div className="bg-white rounded-lg border">
                <OutputTabs
                  intent={fullResult.intent}
                  behavioralSummary={fullResult.behavioralSummary}
                  nodeDetails={fullResult.nodeDetails}
                />
              </div>

              {/* Notes panel */}
              <div className="bg-white rounded-lg border p-4">
                <NotesPanel runResultId={selectedResultId} />
              </div>

              {/* Collapsible sections */}
              <div className="space-y-3">
                <ValidationReport validation={fullResult.validation} />

                <PipelineStats
                  timing={fullResult.timing}
                  chunkCount={fullResult.chunkCount}
                  narratorLlmCalls={fullResult.narratorLlmCalls}
                  narratorDeterministicCalls={fullResult.narratorDeterministicCalls}
                  synthesizerLlmCalls={fullResult.synthesizerLlmCalls}
                />

                <LlmCallLog runId={runId!} resultId={selectedResultId} />
              </div>
            </>
          ) : selectedResultId && loadingResult ? (
            <div className="bg-white rounded-lg border p-6 text-gray-500">
              Loading result details...
            </div>
          ) : (
            <div className="bg-white rounded-lg border p-6 text-gray-500">
              Select a result to view details
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
