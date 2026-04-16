import React, { useState } from "react";

interface Props {
  timing: Record<string, number> | null;
  chunkCount: number | null;
  narratorLlmCalls: number | null;
  narratorDeterministicCalls: number | null;
  synthesizerLlmCalls: number | null;
}

function formatMs(ms: number | undefined | null): string {
  if (ms == null) return "-";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function PipelineStats({
  timing,
  chunkCount,
  narratorLlmCalls,
  narratorDeterministicCalls,
  synthesizerLlmCalls,
}: Props) {
  const [expanded, setExpanded] = useState(false);

  const timingEntries = timing
    ? Object.entries(timing).map(([key, value]) => ({ label: key, value }))
    : [];

  const totalCalls =
    (narratorLlmCalls || 0) + (narratorDeterministicCalls || 0) + (synthesizerLlmCalls || 0);

  return (
    <div className="border rounded">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        <div className="flex items-center gap-3">
          <span>Pipeline Stats</span>
          {timing?.total != null && (
            <span className="text-xs text-gray-500">{formatMs(timing.total)} total</span>
          )}
          {totalCalls > 0 && (
            <span className="text-xs text-gray-500">{totalCalls} calls</span>
          )}
        </div>
        <span className="text-gray-400">{expanded ? "\u2212" : "+"}</span>
      </button>

      {expanded && (
        <div className="border-t px-4 py-3">
          <div className="grid grid-cols-2 gap-6">
            {/* Timing */}
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Timing
              </h4>
              {timingEntries.length > 0 ? (
                <table className="w-full text-sm">
                  <tbody>
                    {timingEntries.map(({ label, value }) => {
                      const maxTime = timing?.total || Math.max(...timingEntries.map((e) => e.value));
                      const pct = maxTime > 0 ? (value / maxTime) * 100 : 0;
                      return (
                        <tr key={label}>
                          <td className="py-1 pr-3 text-gray-600 capitalize">{label}</td>
                          <td className="py-1 pr-3 text-right font-mono text-xs">{formatMs(value)}</td>
                          <td className="py-1 w-24">
                            <div className="bg-gray-100 rounded h-2 overflow-hidden">
                              <div
                                className="bg-blue-400 h-2 rounded"
                                style={{ width: `${Math.min(pct, 100)}%` }}
                              />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <div className="text-xs text-gray-400">No timing data</div>
              )}
            </div>

            {/* Counts */}
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Call Counts
              </h4>
              <table className="w-full text-sm">
                <tbody>
                  <tr>
                    <td className="py-1 pr-3 text-gray-600">Chunks</td>
                    <td className="py-1 font-mono text-xs">{chunkCount ?? "-"}</td>
                  </tr>
                  <tr>
                    <td className="py-1 pr-3 text-gray-600">Narrator LLM</td>
                    <td className="py-1 font-mono text-xs">{narratorLlmCalls ?? "-"}</td>
                  </tr>
                  <tr>
                    <td className="py-1 pr-3 text-gray-600">Narrator Deterministic</td>
                    <td className="py-1 font-mono text-xs">{narratorDeterministicCalls ?? "-"}</td>
                  </tr>
                  <tr>
                    <td className="py-1 pr-3 text-gray-600">Synthesizer LLM</td>
                    <td className="py-1 font-mono text-xs">{synthesizerLlmCalls ?? "-"}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
