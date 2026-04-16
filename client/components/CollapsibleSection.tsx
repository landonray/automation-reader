import React, { useState } from "react";

interface Props {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export function CollapsibleSection({ title, defaultOpen = false, children }: Props) {
  const [expanded, setExpanded] = useState(defaultOpen);

  return (
    <div className="border rounded">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        <span>{title}</span>
        <span className="text-gray-400">{expanded ? "\u2212" : "+"}</span>
      </button>
      {expanded && <div className="border-t px-4 py-3">{children}</div>}
    </div>
  );
}
