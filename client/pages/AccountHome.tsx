import React, { useEffect, useState } from "react";
import { api } from "../api";
import { ConnectAccount } from "../components/ConnectAccount";
import { SuiteCard } from "../components/SuiteCard";

export function AccountHome() {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [suites, setSuites] = useState<any[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
  const [showConnect, setShowConnect] = useState(false);

  useEffect(() => {
    api.accounts.list().then(setAccounts);
  }, []);

  useEffect(() => {
    if (selectedAccount) {
      api.suites.list(selectedAccount).then(setSuites);
    }
  }, [selectedAccount]);

  useEffect(() => {
    if (accounts.length > 0 && !selectedAccount) {
      setSelectedAccount(accounts[0].id);
    }
  }, [accounts]);

  const handleConnect = (account: any) => {
    setAccounts(prev => [...prev, account]);
    setSelectedAccount(account.id);
    setShowConnect(false);
  };

  const handleNewSuite = async () => {
    if (!selectedAccount) return;
    const name = prompt("Suite name:");
    if (!name) return;
    const suite = await api.suites.create({ accountId: selectedAccount, name });
    setSuites(prev => [...prev, suite]);
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Accounts</h1>
        <button onClick={() => setShowConnect(!showConnect)} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium">
          Connect Account
        </button>
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

      {accounts.length > 1 && (
        <div className="mb-6">
          <select
            value={selectedAccount || ""}
            onChange={e => setSelectedAccount(e.target.value)}
            className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
      )}

      {selectedAccount && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-gray-800">Test Suites</h2>
            <button onClick={handleNewSuite} className="px-3 py-1.5 bg-gray-800 text-white rounded-md hover:bg-gray-900 text-sm font-medium">
              New Suite
            </button>
          </div>
          {suites.length === 0 ? (
            <p className="text-gray-500 text-sm">No test suites yet. Create one to get started.</p>
          ) : (
            <div className="space-y-3">
              {suites.map(s => (
                <SuiteCard key={s.id} suite={s} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
