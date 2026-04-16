async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  accounts: {
    list: () => request<any[]>("/api/accounts"),
    create: (data: { name: string; appId: string; apiKey: string }) =>
      request<any>("/api/accounts", { method: "POST", body: JSON.stringify(data) }),
    delete: (id: string) => request<any>(`/api/accounts/${id}`, { method: "DELETE" }),
    automations: (id: string) => request<any[]>(`/api/accounts/${id}/automations`),
  },
  suites: {
    list: (accountId: string) => request<any[]>(`/api/suites?account_id=${accountId}`),
    get: (id: string) => request<any>(`/api/suites/${id}`),
    create: (data: { accountId: string; name: string }) =>
      request<any>("/api/suites", { method: "POST", body: JSON.stringify(data) }),
    addTestCases: (suiteId: string, automationIds: Array<{ id: string; name: string; nodeCount?: number }>) =>
      request<any>(`/api/suites/${suiteId}/test-cases`, { method: "POST", body: JSON.stringify({ automationIds }) }),
    removeTestCase: (id: string) =>
      request<any>(`/api/test-cases/${id}`, { method: "DELETE" }),
  },
  runs: {
    list: (suiteId: string) => request<any[]>(`/api/runs?suite_id=${suiteId}`),
    get: (id: string) => request<any>(`/api/runs/${id}`),
    create: (suiteId: string, label?: string) =>
      request<any>("/api/runs", { method: "POST", body: JSON.stringify({ suiteId, label }) }),
    getResult: (runId: string, resultId: string) =>
      request<any>(`/api/runs/${runId}/results/${resultId}`),
    getLlmCalls: (runId: string, resultId: string) =>
      request<any[]>(`/api/runs/${runId}/results/${resultId}/llm-calls`),
    updateLabel: (id: string, label: string) =>
      request<any>(`/api/runs/${id}`, { method: "PUT", body: JSON.stringify({ label }) }),
    stream: (runId: string) => new EventSource(`/api/runs/${runId}/stream`),
  },
  notes: {
    list: (runResultId: string) => request<any[]>(`/api/notes?run_result_id=${runResultId}`),
    create: (data: { runResultId: string; content: string; layer?: string }) =>
      request<any>("/api/notes", { method: "POST", body: JSON.stringify(data) }),
    update: (id: string, content: string) =>
      request<any>(`/api/notes/${id}`, { method: "PUT", body: JSON.stringify({ content }) }),
    delete: (id: string) => request<any>(`/api/notes/${id}`, { method: "DELETE" }),
  },
  prompts: {
    list: () => request<any[]>("/api/prompts"),
    versions: (key: string) => request<any>(`/api/prompts/${key}/versions`),
    save: (key: string, content: string, note?: string) =>
      request<any>(`/api/prompts/${key}/versions`, {
        method: "POST",
        body: JSON.stringify({ content, note }),
      }),
    restore: (key: string, versionId: string) =>
      request<any>(`/api/prompts/${key}/restore/${versionId}`, { method: "POST" }),
    reset: (key: string) =>
      request<any>(`/api/prompts/${key}/reset`, { method: "POST" }),
  },
};
