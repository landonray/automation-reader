import React, { useState } from "react";

interface Props {
  cache: any;
}

export function EnrichmentViewer({ cache }: Props) {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  if (!cache) return <div className="text-sm text-gray-500">No enrichment data</div>;

  const categories = [
    { key: "fields", label: "Fields" },
    { key: "messages", label: "Messages" },
    { key: "tags", label: "Tags" },
    { key: "campaigns", label: "Campaigns" },
    { key: "products", label: "Products" },
    { key: "forms", label: "Forms" },
    { key: "landing_pages", label: "Landing Pages" },
    { key: "webhooks", label: "Webhooks" },
    { key: "tasks", label: "Tasks" },
  ];

  const toggle = (key: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const filterEntries = (obj: any): [string, any][] => {
    if (!obj || typeof obj !== "object") return [];
    return Object.entries(obj).filter(([k, v]) => {
      if (!search) return true;
      const s = search.toLowerCase();
      const valStr = typeof v === "string" ? v : JSON.stringify(v);
      return k.toLowerCase().includes(s) || valStr.toLowerCase().includes(s);
    });
  };

  return (
    <div>
      <input
        placeholder="Search enrichment cache..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm mb-3 focus:ring-2 focus:ring-blue-500"
      />
      <div className="space-y-2">
        {categories.map(cat => {
          const entries = filterEntries(cache[cat.key]);
          if (entries.length === 0 && !search) return null;
          return (
            <div key={cat.key} className="border rounded-md">
              <button
                onClick={() => toggle(cat.key)}
                className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                <span>{cat.label} ({entries.length})</span>
                <span className="text-gray-400">{expanded.has(cat.key) ? "▼" : "▶"}</span>
              </button>
              {expanded.has(cat.key) && (
                <div className="border-t px-3 py-2 space-y-1">
                  {entries.length === 0 ? (
                    <div className="text-xs text-gray-400">No entries</div>
                  ) : (
                    entries.map(([id, val]) => (
                      <div key={id} className="flex gap-2 text-xs">
                        <span className="text-gray-500 font-mono shrink-0">{id}</span>
                        <span className="text-gray-400">→</span>
                        <span className="text-gray-800">
                          {typeof val === "string"
                            ? val
                            : typeof val === "object" && val !== null
                            ? val.subject || val.name || JSON.stringify(val)
                            : String(val)}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
