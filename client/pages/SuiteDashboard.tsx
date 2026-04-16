import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../api";

export function SuiteDashboard() {
  const { suiteId } = useParams<{ suiteId: string }>();
  const navigate = useNavigate();
  const [suite, setSuite] = useState<any>(null);
  const [runs, setRuns] = useState<any[]>([]);

  useEffect(() => {
    if (suiteId) {
      api.suites.get(suiteId).then(setSuite);
      api.runs.list(suiteId).then(setRuns);
    }
  }, [suiteId]);

  if (!suite) return <div className="text-gray-500">Loading...</div>;

  const handleRun = async () => {
    const label = prompt("Run label (optional):");
    const run = await api.runs.create(suiteId!, label || undefined);
    navigate(`/runs/${run.id}`);
  };

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">{suite.name}</h1>

      <div className="flex gap-3 mb-6">
        <button onClick={handleRun} className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700">
          New Run
        </button>
        <button className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300">
          Add Automations
        </button>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div>
          <h2 className="text-lg font-semibold mb-3">Test Cases ({suite.testCases?.length || 0})</h2>
          <div className="space-y-2">
            {(suite.testCases || []).map((tc: any) => (
              <div key={tc.id} className="bg-white rounded border p-3">
                <div className="font-medium text-sm">{tc.automationName}</div>
                <div className="text-xs text-gray-500">{tc.nodeCount} nodes</div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-3">Runs</h2>
          <div className="space-y-2">
            {runs.map(r => (
              <button key={r.id} onClick={() => navigate(`/runs/${r.id}`)} className="w-full text-left bg-white rounded border p-3 hover:border-blue-400">
                <div className="flex justify-between">
                  <span className="font-medium text-sm">{r.label || "Unlabeled"}</span>
                  <span className={`text-xs px-2 py-0.5 rounded ${r.status === "completed" ? "bg-green-100 text-green-800" : r.status === "running" ? "bg-yellow-100 text-yellow-800" : "bg-red-100 text-red-800"}`}>
                    {r.status}
                  </span>
                </div>
                <div className="text-xs text-gray-500">{new Date(r.startedAt).toLocaleString()}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
