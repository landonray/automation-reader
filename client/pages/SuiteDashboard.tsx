import React, { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { api } from "../api";
import { AutomationPicker } from "../components/AutomationPicker";

export function SuiteDashboard() {
  const { suiteId } = useParams<{ suiteId: string }>();
  const navigate = useNavigate();
  const [suite, setSuite] = useState<any>(null);
  const [runs, setRuns] = useState<any[]>([]);
  const [showPicker, setShowPicker] = useState(false);

  const loadSuite = () => {
    if (suiteId) {
      api.suites.get(suiteId).then(setSuite);
    }
  };

  useEffect(() => {
    if (suiteId) {
      loadSuite();
      api.runs.list(suiteId).then(setRuns);
    }
  }, [suiteId]);

  if (!suite) return <div className="text-gray-500 p-8">Loading...</div>;

  const handleRun = async () => {
    const label = prompt("Run label (optional):");
    const run = await api.runs.create(suiteId!, label || undefined);
    navigate(`/runs/${run.id}`);
  };

  const handleRemoveTestCase = async (testCaseId: string) => {
    if (!confirm("Remove this automation from the suite?")) return;
    await api.suites.removeTestCase(testCaseId);
    loadSuite();
  };

  const handleAutomationsAdded = () => {
    setShowPicker(false);
    loadSuite();
  };

  const existingAutomationIds = (suite.testCases || []).map((tc: any) => tc.automationId);

  const runStatusStyle = (status: string) => {
    if (status === "completed") return "bg-green-100 text-green-800";
    if (status === "running") return "bg-yellow-100 text-yellow-800";
    if (status === "failed") return "bg-red-100 text-red-800";
    return "bg-gray-100 text-gray-800";
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <Link to="/" className="text-sm text-blue-600 hover:underline">&larr; Back to Home</Link>
      </div>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{suite.name}</h1>
        <div className="flex gap-3">
          <button
            onClick={() => setShowPicker(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
          >
            Add Automations
          </button>
          <button
            onClick={handleRun}
            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-medium"
          >
            New Run
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div>
          <h2 className="text-lg font-semibold mb-3 text-gray-800">
            Test Cases ({suite.testCases?.length || 0})
          </h2>
          {(suite.testCases || []).length === 0 ? (
            <div className="bg-white rounded-lg border border-dashed border-gray-300 p-6 text-center">
              <p className="text-sm text-gray-500">No automations yet.</p>
              <button
                onClick={() => setShowPicker(true)}
                className="mt-2 text-sm text-blue-600 hover:underline"
              >
                Add your first automation
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {(suite.testCases || []).map((tc: any) => (
                <div key={tc.id} className="bg-white rounded-lg border border-gray-200 p-3 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-sm text-gray-900 truncate">{tc.automationName}</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {tc.nodeCount != null ? `${tc.nodeCount} nodes` : ""}
                      {tc.nodeCount != null && tc.capturedAt ? " · " : ""}
                      {tc.capturedAt ? `Captured ${new Date(tc.capturedAt).toLocaleDateString()}` : ""}
                    </div>
                  </div>
                  <button
                    onClick={() => handleRemoveTestCase(tc.id)}
                    className="text-gray-300 hover:text-red-500 text-lg leading-none flex-shrink-0 mt-0.5"
                    title="Remove"
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-3 text-gray-800">Runs</h2>
          {runs.length === 0 ? (
            <div className="bg-white rounded-lg border border-dashed border-gray-300 p-6 text-center">
              <p className="text-sm text-gray-500">No runs yet.</p>
              <button
                onClick={handleRun}
                className="mt-2 text-sm text-green-600 hover:underline"
              >
                Start a run
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {runs.map(r => (
                <button
                  key={r.id}
                  onClick={() => navigate(`/runs/${r.id}`)}
                  className="w-full text-left bg-white rounded-lg border border-gray-200 p-3 hover:border-blue-400 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-sm text-gray-900 truncate">
                      {r.label || "Unlabeled run"}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded flex-shrink-0 font-medium ${runStatusStyle(r.status)}`}>
                      {r.status}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {r.startedAt ? new Date(r.startedAt).toLocaleString() : ""}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {showPicker && (
        <AutomationPicker
          accountId={suite.accountId}
          suiteId={suiteId!}
          existingAutomationIds={existingAutomationIds}
          onAdd={handleAutomationsAdded}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  );
}
