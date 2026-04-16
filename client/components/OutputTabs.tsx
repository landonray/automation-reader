import React, { useState } from "react";
import { NotesPanel } from "./NotesPanel";

interface Props {
  intent: string | null;
  behavioralSummary: string | null;
  nodeDetails: any[] | null;
  runResultId?: string;
}

type Tab = "intent" | "summary" | "details";

function renderIntent(text: string): React.ReactNode {
  // Put each "Trigger N:" on its own line
  const formatted = text.replace(/(Trigger\s+\d+:)/g, "\n$1").trim();
  return <div className="whitespace-pre-wrap text-sm text-gray-800">{formatted}</div>;
}

function renderSummary(text: string): React.ReactNode {
  const html = text
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n\n/g, "</p><p class='mt-3'>")
    .replace(/\n/g, "<br/>");
  return (
    <div
      className="prose prose-sm max-w-none text-gray-800"
      dangerouslySetInnerHTML={{ __html: `<p>${html}</p>` }}
    />
  );
}

function renderNodeDetails(layers: any[]): React.ReactNode {
  if (!Array.isArray(layers) || layers.length === 0) {
    return <div className="text-sm text-gray-500">No node details available</div>;
  }

  return (
    <div className="space-y-4">
      {layers.map((layer: any, li: number) => (
        <div key={li} className="border rounded overflow-hidden">
          {layer.chunk_narration && (
            <div className="bg-gray-50 border-b px-3 py-2 text-xs text-gray-600 italic">
              {layer.chunk_narration}
            </div>
          )}
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="text-left p-2 font-medium text-gray-600">Node</th>
                <th className="text-left p-2 font-medium text-gray-600">Type</th>
                <th className="text-left p-2 font-medium text-gray-600">Description</th>
                <th className="text-left p-2 font-medium text-gray-600">Timing</th>
              </tr>
            </thead>
            <tbody>
              {(layer.nodes || []).map((node: any, ni: number) => (
                <tr key={ni} className="border-b last:border-0">
                  <td className="p-2 font-mono text-xs">{node.label || node.id || `Node ${ni + 1}`}</td>
                  <td className="p-2 text-gray-600">{node.type || "-"}</td>
                  <td className="p-2 text-gray-700">{node.resolved_description || "-"}</td>
                  <td className="p-2 text-xs text-gray-500">
                    {node.timing
                      ? [
                          node.timing.days > 0 && `${node.timing.days}d`,
                          node.timing.hours > 0 && `${node.timing.hours}h`,
                          node.timing.minutes > 0 && `${node.timing.minutes}m`,
                        ].filter(Boolean).join(" ") || "-"
                      : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

export function OutputTabs({ intent, behavioralSummary, nodeDetails, runResultId }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("intent");

  const tabs: { key: Tab; label: string }[] = [
    { key: "intent", label: "Intent" },
    { key: "summary", label: "Behavioral Summary" },
    { key: "details", label: "Node Details" },
  ];

  return (
    <div>
      <div className="border-b px-4">
        <div className="flex gap-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === t.key
                  ? "border-blue-500 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="p-6">
        {activeTab === "intent" && (
          <>
            {intent ? renderIntent(intent) : <div className="text-sm text-gray-500">No intent data</div>}
            {runResultId && <NotesPanel runResultId={runResultId} layer="intent" />}
          </>
        )}
        {activeTab === "summary" && (
          <>
            {behavioralSummary ? renderSummary(behavioralSummary) : <div className="text-sm text-gray-500">No summary data</div>}
            {runResultId && <NotesPanel runResultId={runResultId} layer="behavioral_summary" />}
          </>
        )}
        {activeTab === "details" && (
          <>
            {renderNodeDetails(nodeDetails || [])}
            {runResultId && <NotesPanel runResultId={runResultId} layer="node_details" />}
          </>
        )}
      </div>
    </div>
  );
}
