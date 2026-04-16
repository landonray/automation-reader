import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";

export function AccountHome() {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [suites, setSuites] = useState<any[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
  const [showConnect, setShowConnect] = useState(false);
  const [form, setForm] = useState({ name: "", appId: "", apiKey: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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

  const handleConnect = async () => {
    setError("");
    setLoading(true);
    try {
      const account = await api.accounts.create(form);
      setAccounts(prev => [...prev, account]);
      setSelectedAccount(account.id);
      setShowConnect(false);
      setForm({ name: "", appId: "", apiKey: "" });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
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
        <button onClick={() => setShowConnect(!showConnect)} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
          Connect Account
        </button>
      </div>

      {showConnect && (
        <div className="bg-white rounded-lg border p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Connect Ontraport Account</h2>
          {error && <div className="text-red-600 mb-3 text-sm">{error}</div>}
          <div className="space-y-3">
            <input placeholder="Nickname" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="w-full border rounded px-3 py-2" />
            <input placeholder="App ID" value={form.appId} onChange={e => setForm(f => ({ ...f, appId: e.target.value }))} className="w-full border rounded px-3 py-2" />
            <input placeholder="API Key" type="password" value={form.apiKey} onChange={e => setForm(f => ({ ...f, apiKey: e.target.value }))} className="w-full border rounded px-3 py-2" />
            <button onClick={handleConnect} disabled={loading} className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50">
              {loading ? "Validating..." : "Connect"}
            </button>
          </div>
        </div>
      )}

      {accounts.length > 1 && (
        <div className="mb-6">
          <select value={selectedAccount || ""} onChange={e => setSelectedAccount(e.target.value)} className="border rounded px-3 py-2">
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
      )}

      {selectedAccount && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-gray-800">Test Suites</h2>
            <button onClick={handleNewSuite} className="px-3 py-1.5 bg-gray-800 text-white rounded hover:bg-gray-900 text-sm">
              New Suite
            </button>
          </div>
          {suites.length === 0 ? (
            <p className="text-gray-500">No test suites yet. Create one to get started.</p>
          ) : (
            <div className="space-y-3">
              {suites.map(s => (
                <Link key={s.id} to={`/suites/${s.id}`} className="block bg-white rounded-lg border p-4 hover:border-blue-400 transition">
                  <div className="font-medium text-gray-900">{s.name}</div>
                  <div className="text-sm text-gray-500">Created {new Date(s.createdAt).toLocaleDateString()}</div>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {accounts.length === 0 && !showConnect && (
        <p className="text-gray-500">No accounts connected. Click "Connect Account" to get started.</p>
      )}
    </div>
  );
}
