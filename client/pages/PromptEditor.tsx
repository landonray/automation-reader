import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api";

interface PromptRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  currentVersionId: string | null;
  currentVersion: number | null;
  currentContent: string | null;
  defaultContent: string | null;
  versionCount: number;
  updatedAt: string;
}

interface VersionRow {
  id: string;
  version: number;
  content: string;
  note: string | null;
  createdAt: string;
  isCurrent: boolean;
}

function formatRelativeDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function PromptEditor() {
  const [promptList, setPromptList] = useState<PromptRow[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<string>("");
  const [noteInput, setNoteInput] = useState<string>("");
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [viewingVersionId, setViewingVersionId] = useState<string | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const selected = useMemo(
    () => promptList.find((p) => p.key === selectedKey) ?? null,
    [promptList, selectedKey],
  );

  const viewedVersion = useMemo(
    () => versions.find((v) => v.id === viewingVersionId) ?? null,
    [versions, viewingVersionId],
  );

  const currentVersion = useMemo(
    () => versions.find((v) => v.isCurrent) ?? null,
    [versions],
  );

  const dirty =
    selected !== null &&
    (selected.currentContent ?? "") !== draft;

  async function refreshList() {
    setLoadingList(true);
    try {
      const rows = await api.prompts.list();
      setPromptList(rows);
      if (!selectedKey && rows.length > 0) {
        setSelectedKey(rows[0].key);
      }
    } catch (err: any) {
      setBanner({ kind: "err", text: `Failed to load prompts: ${err.message}` });
    } finally {
      setLoadingList(false);
    }
  }

  async function refreshVersions(key: string) {
    setLoadingVersions(true);
    try {
      const data = await api.prompts.versions(key);
      setVersions(data.versions);
      const current = data.versions.find((v: VersionRow) => v.isCurrent);
      setViewingVersionId(current?.id ?? null);
    } catch (err: any) {
      setBanner({ kind: "err", text: `Failed to load versions: ${err.message}` });
    } finally {
      setLoadingVersions(false);
    }
  }

  useEffect(() => {
    refreshList();
  }, []);

  useEffect(() => {
    if (!selected) {
      setDraft("");
      setVersions([]);
      return;
    }
    setDraft(selected.currentContent ?? "");
    setNoteInput("");
    refreshVersions(selected.key);
  }, [selectedKey, selected?.currentVersionId]);

  function handleSelect(key: string) {
    if (dirty && !window.confirm("Discard unsaved changes to this prompt?")) return;
    setSelectedKey(key);
    setBanner(null);
  }

  async function handleSave() {
    if (!selected || !dirty) return;
    setSaving(true);
    setBanner(null);
    try {
      await api.prompts.save(selected.key, draft, noteInput.trim() || undefined);
      setBanner({ kind: "ok", text: "Saved. Future runs will use this version." });
      setNoteInput("");
      await refreshList();
      await refreshVersions(selected.key);
    } catch (err: any) {
      setBanner({ kind: "err", text: `Save failed: ${err.message}` });
    } finally {
      setSaving(false);
    }
  }

  async function handleRestore(versionId: string) {
    if (!selected) return;
    const v = versions.find((x) => x.id === versionId);
    if (!v) return;
    if (!window.confirm(`Restore version ${v.version} as the active prompt?\n\nThis creates a new version pointing at the old content — nothing is lost.`)) return;
    setSaving(true);
    setBanner(null);
    try {
      await api.prompts.restore(selected.key, versionId);
      setBanner({ kind: "ok", text: `Version ${v.version} is now active.` });
      await refreshList();
      await refreshVersions(selected.key);
    } catch (err: any) {
      setBanner({ kind: "err", text: `Restore failed: ${err.message}` });
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    if (!selected) return;
    if (!window.confirm("Reset this prompt to the built-in default?\n\nThis saves the default as a new version; your previous edits remain in history.")) return;
    setSaving(true);
    setBanner(null);
    try {
      await api.prompts.reset(selected.key);
      setBanner({ kind: "ok", text: "Reset to default. Future runs will use the default." });
      await refreshList();
      await refreshVersions(selected.key);
    } catch (err: any) {
      setBanner({ kind: "err", text: `Reset failed: ${err.message}` });
    } finally {
      setSaving(false);
    }
  }

  function handleViewVersion(versionId: string) {
    setViewingVersionId(versionId);
  }

  function handleLoadIntoEditor() {
    if (!viewedVersion) return;
    if (dirty && !window.confirm("Replace your unsaved changes with this version's content?")) return;
    setDraft(viewedVersion.content);
  }

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Prompts</h1>
        <p className="text-sm text-gray-500 mt-1">
          Edit the prompts the system sends to the LLM. Every save creates a new version — you can roll back any time.
        </p>
      </div>

      <div className="grid grid-cols-12 gap-6">
        {/* LEFT — prompt list */}
        <aside className="col-span-4 xl:col-span-3">
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-600">
                System Prompts
              </h2>
            </div>
            {loadingList ? (
              <div className="p-4 text-sm text-gray-500">Loading…</div>
            ) : promptList.length === 0 ? (
              <div className="p-4 text-sm text-gray-500">No prompts found.</div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {promptList.map((p) => {
                  const isActive = p.key === selectedKey;
                  return (
                    <li key={p.key}>
                      <button
                        onClick={() => handleSelect(p.key)}
                        className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors ${
                          isActive ? "bg-blue-50 border-l-2 border-blue-600" : "border-l-2 border-transparent"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className={`text-sm font-medium ${isActive ? "text-blue-900" : "text-gray-900"}`}>
                            {p.name}
                          </span>
                          <span className="text-xs text-gray-500 shrink-0">
                            v{p.currentVersion ?? "?"}
                          </span>
                        </div>
                        {p.description && (
                          <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                            {p.description}
                          </p>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>

        {/* RIGHT — editor */}
        <section className="col-span-8 xl:col-span-9">
          {!selected ? (
            <div className="bg-white border border-gray-200 rounded-lg p-12 text-center text-gray-500 text-sm">
              Select a prompt to edit.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="bg-white border border-gray-200 rounded-lg p-5">
                <div className="flex items-start justify-between gap-4 mb-2">
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900">{selected.name}</h2>
                    {selected.description && (
                      <p className="text-sm text-gray-600 mt-1">{selected.description}</p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs text-gray-500">
                      Current version
                    </div>
                    <div className="text-lg font-semibold text-gray-900">
                      v{selected.currentVersion ?? "?"}
                    </div>
                    <div className="text-xs text-gray-400">
                      {selected.versionCount} total
                    </div>
                  </div>
                </div>
                {selected.key.startsWith("synth_") && (
                  <div className="mt-3 text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded px-3 py-2">
                    <span className="font-semibold text-gray-700">Tip:</span> use <code className="bg-white border border-gray-200 rounded px-1 py-0.5 text-[11px]">{"{{synthesis_rules}}"}</code> to include the shared synthesis rules. It's replaced at runtime with the current active version of the Synthesis Rules prompt.
                  </div>
                )}
              </div>

              {banner && (
                <div
                  className={`border rounded-lg px-4 py-3 text-sm ${
                    banner.kind === "ok"
                      ? "bg-green-50 border-green-200 text-green-900"
                      : "bg-red-50 border-red-200 text-red-900"
                  }`}
                >
                  {banner.text}
                </div>
              )}

              <div className="bg-white border border-gray-200 rounded-lg">
                <div className="px-4 py-2 border-b border-gray-200 flex items-center justify-between bg-gray-50">
                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-600">
                    Editor
                  </span>
                  {dirty && (
                    <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-0.5">
                      Unsaved changes
                    </span>
                  )}
                </div>
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  spellCheck={false}
                  className="w-full h-[480px] p-4 font-mono text-[13px] leading-relaxed text-gray-800 focus:outline-none resize-y"
                />
                <div className="px-4 py-3 border-t border-gray-200 bg-gray-50 flex flex-col sm:flex-row sm:items-center gap-3">
                  <input
                    type="text"
                    value={noteInput}
                    onChange={(e) => setNoteInput(e.target.value)}
                    placeholder="Optional note about this change (what / why)"
                    className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                  />
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={handleReset}
                      disabled={saving}
                      className="px-3 py-2 text-sm text-gray-700 hover:bg-gray-200 rounded-md disabled:opacity-50"
                      title="Save the code default as a new version"
                    >
                      Reset to default
                    </button>
                    <button
                      onClick={() => setDraft(selected.currentContent ?? "")}
                      disabled={saving || !dirty}
                      className="px-3 py-2 text-sm text-gray-700 hover:bg-gray-200 rounded-md disabled:opacity-50"
                    >
                      Revert
                    </button>
                    <button
                      onClick={handleSave}
                      disabled={saving || !dirty}
                      className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {saving ? "Saving…" : "Save new version"}
                    </button>
                  </div>
                </div>
              </div>

              {/* Version history */}
              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                <div className="px-4 py-2 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-600">
                    Version History
                  </span>
                  <span className="text-xs text-gray-500">
                    {versions.length} {versions.length === 1 ? "version" : "versions"}
                  </span>
                </div>
                {loadingVersions ? (
                  <div className="p-4 text-sm text-gray-500">Loading versions…</div>
                ) : versions.length === 0 ? (
                  <div className="p-4 text-sm text-gray-500">No versions yet.</div>
                ) : (
                  <div className="grid grid-cols-12 divide-x divide-gray-100">
                    <ul className="col-span-4 divide-y divide-gray-100 max-h-[360px] overflow-y-auto">
                      {versions.map((v) => {
                        const isViewing = v.id === viewingVersionId;
                        return (
                          <li key={v.id}>
                            <button
                              onClick={() => handleViewVersion(v.id)}
                              className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors ${
                                isViewing ? "bg-blue-50" : ""
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-sm font-medium text-gray-900">
                                  v{v.version}
                                </span>
                                {v.isCurrent && (
                                  <span className="text-[10px] font-semibold uppercase tracking-wide text-green-800 bg-green-100 px-1.5 py-0.5 rounded">
                                    Active
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-gray-500 mt-0.5">
                                {formatRelativeDate(v.createdAt)}
                              </div>
                              {v.note && (
                                <div className="text-xs text-gray-700 mt-1 line-clamp-2 italic">
                                  "{v.note}"
                                </div>
                              )}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                    <div className="col-span-8 flex flex-col">
                      {viewedVersion ? (
                        <>
                          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-3 bg-white">
                            <div>
                              <div className="text-sm font-semibold text-gray-900">
                                Viewing v{viewedVersion.version}
                                {viewedVersion.isCurrent && (
                                  <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-green-800 bg-green-100 px-1.5 py-0.5 rounded">
                                    Active
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-gray-500">
                                {formatRelativeDate(viewedVersion.createdAt)}
                                {viewedVersion.note && <> — "{viewedVersion.note}"</>}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={handleLoadIntoEditor}
                                className="px-3 py-1.5 text-xs text-gray-700 border border-gray-300 rounded-md hover:bg-gray-100"
                              >
                                Load into editor
                              </button>
                              <button
                                onClick={() => handleRestore(viewedVersion.id)}
                                disabled={viewedVersion.isCurrent || saving}
                                className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                title={viewedVersion.isCurrent ? "This version is already active" : "Make this the active version"}
                              >
                                {viewedVersion.isCurrent ? "Already active" : "Restore this version"}
                              </button>
                            </div>
                          </div>
                          <pre className="flex-1 p-4 text-[12px] font-mono text-gray-800 whitespace-pre-wrap overflow-auto max-h-[360px] bg-gray-50">
                            {viewedVersion.content}
                          </pre>
                          {currentVersion && !viewedVersion.isCurrent && (
                            <div className="px-4 py-2 border-t border-gray-100 text-xs text-gray-500 bg-white">
                              Comparing against active v{currentVersion.version}
                              {" · "}
                              <DiffSummary
                                current={currentVersion.content}
                                other={viewedVersion.content}
                              />
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="p-6 text-sm text-gray-500">
                          Select a version to preview.
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function DiffSummary({ current, other }: { current: string; other: string }) {
  const currentLines = current.split("\n");
  const otherLines = other.split("\n");
  const added = Math.max(0, otherLines.length - currentLines.length);
  const removed = Math.max(0, currentLines.length - otherLines.length);
  const charDelta = other.length - current.length;
  const sign = charDelta > 0 ? "+" : "";
  return (
    <span>
      {otherLines.length} lines ({added > 0 ? `+${added}` : removed > 0 ? `−${removed}` : "same count"})
      {" · "}
      {sign}
      {charDelta} chars
    </span>
  );
}
