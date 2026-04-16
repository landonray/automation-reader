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

function renderNodeDetails(nodes: any[]): React.ReactNode {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return <div className="text-sm text-gray-500">No node details available</div>;
  }

  return (
    <div className="overflow-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b bg-gray-50">
            <th className="text-left p-2 font-medium text-gray-600">Node</th>
            <th className="text-left p-2 font-medium text-gray-600">Type</th>
            <th className="text-left p-2 font-medium text-gray-600">Description</th>
          </tr>
        </thead>
        <tbody>
          {nodes.map((node: any, i: number) => (
            <tr key={i} className="border-b last:border-0">
              <td className="p-2 font-mono text-xs">{node.name || node.id || `Node ${i + 1}`}</td>
              <td className="p-2 text-gray-600">{node.type || "-"}</td>
              <td className="p-2 text-gray-700">{node.description || node.summary || JSON.stringify(node)}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
