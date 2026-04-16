import React, { useEffect, useState } from "react";
import { api } from "../api";
import { useAppContext } from "../context/AppContext";
import { ConnectAccount } from "../components/ConnectAccount";
import { SuiteCard } from "../components/SuiteCard";

export function AccountHome() {
  const { accounts, selectedAccountId, addAccount } = useAppContext();
  const [suites, setSuites] = useState<any[]>([]);
  const [showConnect, setShowConnect] = useState(false);

  useEffect(() => {
    if (selectedAccountId) {
      api.suites.list(selectedAccountId).then(setSuites);
    }
  }, [selectedAccountId]);

  const handleConnect = (account: any) => {
    addAccount(account);
    setShowConnect(false);
  };

  const handleNewSuite = async () => {
    if (!selectedAccountId) return;
    const name = prompt("Suite name:");
    if (!name) return;
    const suite = await api.suites.create({ accountId: selectedAccountId, name });
    setSuites(prev => [...prev, suite]);
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Test Suites</h1>
        <div className="flex gap-3">
          <button onClick={() => setShowConnect(!showConnect)} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm font-medium">
            Connect Account
          </button>
          {selectedAccountId && (
            <button onClick={handleNewSuite} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium">
              New Suite
            </button>
          )}
        </div>
      </div>

      {showConnect && (
        <ConnectAccount
          onConnect={handleConnect}
          onCancel={() => setShowConnect(false)}
        />
      )}

      {accounts.length === 0 && !showConnect && (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
          <p className="text-gray-500 mb-4">No accounts connected yet.</p>
          <button onClick={() => setShowConnect(true)} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium">
            Connect Your First Account
          </button>
        </div>
      )}

      {selectedAccountId && suites.length === 0 && accounts.length > 0 && !showConnect && (
        <p className="text-gray-500 text-sm">No test suites yet. Create one to get started.</p>
      )}

      {selectedAccountId && suites.length > 0 && (
        <div className="space-y-3">
          {suites.map(s => (
            <SuiteCard key={s.id} suite={s} />
          ))}
        </div>
      )}
    </div>
  );
}
