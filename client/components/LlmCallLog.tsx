import React, { useState } from "react";
import { api } from "../api";

interface LlmCall {
  id: string;
  stage: string;
  chunkId?: string;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedCost?: number;
  systemPrompt?: string;
  userPrompt?: string;
  response?: string;
  model?: string;
}

interface Props {
  runId: string;
  resultId: string;
}

export function LlmCallLog({ runId, resultId }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [calls, setCalls] = useState<LlmCall[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedCall, setExpandedCall] = useState<string | null>(null);

  async function toggle() {
    if (!expanded && calls.length === 0) {
      setLoading(true);
      try {
        const data = await api.runs.getLlmCalls(runId, resultId);
        setCalls(data);
      } catch {
        setCalls([]);
      }
      setLoading(false);
    }
    setExpanded(!expanded);
  }

  return (
    <div className="border rounded">
      <button
        onClick={toggle}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        <span>LLM Call Log ({calls.length > 0 ? calls.length : "..."})</span>
        <span className="text-gray-400">{expanded ? "−" : "+"}</span>
      </button>

      {expanded && (
        <div className="border-t px-4 py-3">
          {loading ? (
            <div className="text-sm text-gray-500">Loading...</div>
          ) : calls.length === 0 ? (
            <div className="text-sm text-gray-500">No LLM calls recorded</div>
          ) : (
            <div className="space-y-2">
              {calls.map((call) => (
                <div key={call.id} className="border rounded text-sm">
                  <button
                    onClick={() =>
                      setExpandedCall(expandedCall === call.id ? null : call.id)
                    }
                    className="w-full flex items-center gap-3 px-3 py-2 hover:bg-gray-50 text-left"
                  >
                    <span
                      className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                        call.stage === "narrator"
                          ? "bg-purple-100 text-purple-700"
                          : "bg-indigo-100 text-indigo-700"
                      }`}
                    >
                      {call.stage}
                    </span>
                    {call.chunkId && (
                      <span className="text-xs text-gray-500">chunk {call.chunkId}</span>
                    )}
                    {call.latencyMs != null && (
                      <span className="text-xs text-gray-500">
                        {(call.latencyMs / 1000).toFixed(2)}s
                      </span>
                    )}
                    {(call.totalTokens || call.inputTokens) && (
                      <span className="text-xs text-gray-500">
                        {call.totalTokens || (call.inputTokens || 0) + (call.outputTokens || 0)} tokens
                      </span>
                    )}
                    {call.estimatedCost != null && (
                      <span className="text-xs text-gray-500">
                        ${call.estimatedCost.toFixed(4)}
                      </span>
                    )}
                    <span className="ml-auto text-gray-400">
                      {expandedCall === call.id ? "−" : "+"}
                    </span>
                  </button>

                  {expandedCall === call.id && (
                    <div className="border-t px-3 py-3 space-y-3 bg-gray-50">
                      {call.model && (
                        <div>
                          <div className="text-xs font-medium text-gray-500 mb-1">Model</div>
                          <div className="text-xs text-gray-700">{call.model}</div>
                        </div>
                      )}
                      {call.systemPrompt && (
                        <div>
                          <div className="text-xs font-medium text-gray-500 mb-1">System Prompt</div>
                          <pre className="text-xs text-gray-700 whitespace-pre-wrap bg-white border rounded p-2 max-h-48 overflow-auto">
                            {call.systemPrompt}
                          </pre>
                        </div>
                      )}
                      {call.userPrompt && (
                        <div>
                          <div className="text-xs font-medium text-gray-500 mb-1">User Prompt</div>
                          <pre className="text-xs text-gray-700 whitespace-pre-wrap bg-white border rounded p-2 max-h-48 overflow-auto">
                            {call.userPrompt}
                          </pre>
                        </div>
                      )}
                      {call.response && (
                        <div>
                          <div className="text-xs font-medium text-gray-500 mb-1">Response</div>
                          <pre className="text-xs text-gray-700 whitespace-pre-wrap bg-white border rounded p-2 max-h-48 overflow-auto">
                            {call.response}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
