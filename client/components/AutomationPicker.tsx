import React, { useState } from "react";
import { api } from "../api";
import { useAppContext } from "../context/AppContext";

interface Props {
  accountId: string;
  suiteId: string;
  existingAutomationIds: string[];
  onAdd: (testCases: any[]) => void;
  onClose: () => void;
}

export function AutomationPicker({ accountId, suiteId, existingAutomationIds, onAdd, onClose }: Props) {
  const { automations, automationsLoading, refreshAutomations } = useAppContext();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const loading = automationsLoading;

  const filtered = automations.filter(a =>
    a.name.toLowerCase().includes(search.toLowerCase())
  );

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAdd = async () => {
    setAdding(true);
    try {
      const testCases = await api.suites.addTestCases(suiteId, [...selected]);
      onAdd(testCases);
    } catch (e) {
      console.error(e);
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col">
        <div className="p-4 border-b flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold">Add Automations</h2>
            <button
              onClick={refreshAutomations}
              disabled={loading}
              className="text-xs text-blue-600 hover:text-blue-800 disabled:opacity-50"
              title="Refresh automation list from Ontraport"
            >
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
        </div>

        <div className="p-4 border-b">
          <input
            placeholder="Search automations..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {loading ? (
            <div className="text-center text-gray-500 py-8">Loading automations...</div>
          ) : filtered.length === 0 ? (
            <div className="text-center text-gray-500 py-8">No automations found</div>
          ) : (
            filtered.map(a => {
              const isExisting = existingAutomationIds.includes(a.id);
              return (
                <label key={a.id} className={`flex items-center gap-3 px-3 py-2 rounded hover:bg-gray-50 cursor-pointer ${isExisting ? "opacity-50" : ""}`}>
                  <input
                    type="checkbox"
                    checked={selected.has(a.id) || isExisting}
                    disabled={isExisting}
                    onChange={() => toggleSelect(a.id)}
                    className="rounded border-gray-300"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">{a.name}</div>
                    <div className="text-xs text-gray-500">{a.status} &middot; ID: {a.id}</div>
                  </div>
                </label>
              );
            })
          )}
        </div>

        <div className="p-4 border-t flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200">
            Cancel
          </button>
          <button onClick={handleAdd} disabled={selected.size === 0 || adding} className="px-4 py-2 text-sm text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50">
            {adding ? "Adding..." : `Add ${selected.size} Automation${selected.size !== 1 ? "s" : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}
