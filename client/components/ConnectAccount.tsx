import React, { useState } from "react";
import { api } from "../api";

interface Props {
  onConnect: (account: any) => void;
  onCancel: () => void;
}

export function ConnectAccount({ onConnect, onCancel }: Props) {
  const [form, setForm] = useState({ name: "", appId: "", apiKey: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.appId || !form.apiKey) {
      setError("All fields are required");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const account = await api.accounts.create(form);
      onConnect(account);
    } catch (err: any) {
      setError(err.message || "Failed to connect");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-lg border border-gray-200 p-6 mb-6 shadow-sm">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Connect Ontraport Account</h2>
      {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded mb-4 text-sm">{error}</div>}
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Nickname</label>
          <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" placeholder="e.g. Production Account" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">App ID</label>
          <input value={form.appId} onChange={e => setForm(f => ({ ...f, appId: e.target.value }))} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500" placeholder="2_..." />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">API Key</label>
          <input type="password" value={form.apiKey} onChange={e => setForm(f => ({ ...f, apiKey: e.target.value }))} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
        </div>
        <div className="flex gap-3">
          <button type="submit" disabled={loading} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 text-sm font-medium">
            {loading ? "Validating..." : "Connect"}
          </button>
          <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 text-sm">
            Cancel
          </button>
        </div>
      </div>
    </form>
  );
}
