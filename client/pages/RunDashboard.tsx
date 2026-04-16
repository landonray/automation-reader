import React, { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { api } from "../api";
import { useAppContext } from "../context/AppContext";
import { useSSE } from "../hooks/useSSE";
import { ResultsList } from "../components/ResultsList";
import { OutputTabs } from "../components/OutputTabs";
import { NotesPanel } from "../components/NotesPanel";
import { ValidationReport } from "../components/ValidationReport";
import { PipelineStats } from "../components/PipelineStats";
import { LlmCallLog } from "../components/LlmCallLog";
import { RunComparison } from "../components/RunComparison";
import { EnrichmentViewer } from "../components/EnrichmentViewer";
import { ChunkTree } from "../components/ChunkTree";

// Simple collapsible wrapper matching the style of other sections in this view
function CollapsibleSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="border rounded">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        <span>{title}</span>
        <span className="text-gray-400">{expanded ? "\u2212" : "+"}</span>
      </button>
      {expanded && <div className="border-t px-4 py-3">{children}</div>}
    </div>
  );
}

export function RunDashboard() {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const { currentSuite } = useAppContext();
  const [run, setRun] = useState<any>(null);
  const [allRuns, setAllRuns] = useState<any[]>([]);
  const [selectedResultId, setSelectedResultId] = useState<string | null>(null);
  const [fullResult, setFullResult] = useState<any>(null);
  const [loadingResult, setLoadingResult] = useState(false);
  const [compareMode, setCompareMode] = useState(false);
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelValue, setLabelValue] = useState("");

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

  // Load all runs for this suite (for dropdown/nav)
  useEffect(() => {
    if (run?.suiteId) {
      api.runs.list(run.suiteId).then((rows) => {
        // Sort newest first
        const sorted = [...rows].sort(
          (a, b) => new Date(b.startedAt || b.createdAt).getTime() - new Date(a.startedAt || a.createdAt).getTime()
        );
        setAllRuns(sorted);
      });
    }
  }, [run?.suiteId]);

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

  // Nav helpers
  const currentIndex = allRuns.findIndex((r) => r.id === runId);
  const canGoPrev = currentIndex > 0;
  const canGoNext = currentIndex >= 0 && currentIndex < allRuns.length - 1;
  const goToRun = (id: string) => navigate(`/runs/${id}`);
  const goPrev = () => { if (canGoPrev) goToRun(allRuns[currentIndex - 1].id); };
  const goNext = () => { if (canGoNext) goToRun(allRuns[currentIndex + 1].id); };

  // Label editing
  const startLabelEdit = () => {
    setLabelValue(run?.label || "");
    setEditingLabel(true);
  };
  const saveLabel = async () => {
    if (!runId) return;
    await api.runs.updateLabel(runId, labelValue);
    setEditingLabel(false);
    loadRun();
  };

  if (!run) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">Loading run...</div>
    );
  }

  // Summary stats from results
  const results = run.results || [];
  const totalAutomations = results.length;
  const failedCount = results.filter((r: any) => r.status === "failed").length;
  const warningCount = results.filter((r: any) => {
    const v = r.validation;
    return v && (v.warnings?.length > 0 || v.validationWarnings?.length > 0);
  }).length;

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
      {/* Run bar */}
      <div className="mb-6 bg-white border rounded-lg px-5 py-3 space-y-3">
        {/* Row 1: Nav, dropdown, status, stats, actions */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* Nav arrows */}
          <button
            onClick={goPrev}
            disabled={!canGoPrev}
            className="px-2 py-1 rounded border text-sm font-medium disabled:opacity-30 disabled:cursor-not-allowed hover:bg-gray-50"
            title="Previous run"
          >
            &larr;
          </button>
          <button
            onClick={goNext}
            disabled={!canGoNext}
            className="px-2 py-1 rounded border text-sm font-medium disabled:opacity-30 disabled:cursor-not-allowed hover:bg-gray-50"
            title="Next run"
          >
            &rarr;
          </button>

          {/* Run dropdown */}
          <select
            value={runId || ""}
            onChange={(e) => goToRun(e.target.value)}
            className="border rounded px-2 py-1 text-sm bg-white min-w-[220px]"
          >
            {allRuns.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label || "Unlabeled"} — {new Date(r.startedAt || r.createdAt).toLocaleDateString()} ({r.status})
              </option>
            ))}
          </select>

          {/* Status badge */}
          <span className={`px-3 py-1 rounded text-sm font-medium ${statusColor}`}>
            {run.status}
          </span>

          {/* Summary stats */}
          <div className="flex items-center gap-3 text-sm text-gray-600 ml-2">
            <span>{totalAutomations} automation{totalAutomations !== 1 ? "s" : ""}</span>
            {failedCount > 0 && (
              <span className="text-red-600 font-medium">{failedCount} failed</span>
            )}
            {warningCount > 0 && (
              <span className="text-yellow-600 font-medium">{warningCount} warning{warningCount !== 1 ? "s" : ""}</span>
            )}
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Compare button */}
          {!compareMode && run.suiteId && (
            <button
              onClick={() => setCompareMode(true)}
              className="px-3 py-1 border rounded text-sm text-blue-600 hover:bg-blue-50"
            >
              Compare
            </button>
          )}

          {/* Add/Remove Automations link */}
          {run.suiteId && (
            <Link
              to={`/suites/${run.suiteId}`}
              className="px-3 py-1 border rounded text-sm text-blue-600 hover:bg-blue-50"
            >
              Add/Remove Automations
            </Link>
          )}
        </div>

        {/* Row 2: Label (inline editing) */}
        <div className="flex items-center gap-2">
          {editingLabel ? (
            <>
              <input
                autoFocus
                value={labelValue}
                onChange={(e) => setLabelValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveLabel();
                  if (e.key === "Escape") setEditingLabel(false);
                }}
                className="border rounded px-2 py-1 text-sm flex-1 max-w-sm"
                placeholder="Run label..."
              />
              <button onClick={saveLabel} className="text-sm text-blue-600 hover:underline">
                Save
              </button>
              <button onClick={() => setEditingLabel(false)} className="text-sm text-gray-500 hover:underline">
                Cancel
              </button>
            </>
          ) : (
            <>
              <h1
                className="text-lg font-semibold text-gray-900 cursor-pointer hover:text-blue-600"
                onClick={startLabelEdit}
                title="Click to edit label"
              >
                {run.label || "Unlabeled run"}
              </h1>
              <button
                onClick={startLabelEdit}
                className="text-gray-400 hover:text-gray-600 text-sm"
                title="Edit label"
              >
                &#9998;
              </button>
            </>
          )}
          {run.startedAt && (
            <span className="text-xs text-gray-400 ml-4">
              Started {new Date(run.startedAt).toLocaleString()}
            </span>
          )}
          {run.completedAt && (
            <span className="text-xs text-gray-400">
              &middot; Completed {new Date(run.completedAt).toLocaleString()}
            </span>
          )}
        </div>
      </div>

      {/* Compare mode */}
      {compareMode && run.suiteId && (
        <RunComparison
          baseRun={run}
          suiteId={run.suiteId}
          onExit={() => setCompareMode(false)}
        />
      )}

      {/* Two-column layout — hidden when in compare mode */}
      {!compareMode && <div className="grid grid-cols-[280px_1fr] gap-6">
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

                {/* Enrichment Cache */}
                <CollapsibleSection title="Enrichment Cache">
                  <EnrichmentViewer cache={fullResult.enrichmentCache} />
                </CollapsibleSection>

                {/* Chunk Tree */}
                <CollapsibleSection title="Chunk Tree">
                  <ChunkTree chunks={fullResult.chunks} />
                </CollapsibleSection>
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
      </div>}
    </div>
  );
}
