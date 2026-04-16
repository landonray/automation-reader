import React, { useState } from "react";

interface Props {
  chunks: any[];
}

const TYPE_COLORS: Record<string, string> = {
  trigger: "bg-blue-100 text-blue-800 border-blue-200",
  goal: "bg-green-100 text-green-800 border-green-200",
  fork_branch: "bg-gray-100 text-gray-700 border-gray-200",
  fork_branch_goal: "bg-emerald-100 text-emerald-800 border-emerald-200",
};

function ChunkNode({
  chunk,
  chunkMap,
  depth,
}: {
  chunk: any;
  chunkMap: Map<string, any>;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const colorClass =
    TYPE_COLORS[chunk.entry_type] || "bg-gray-50 text-gray-700 border-gray-200";
  const subChunks = (chunk.sub_chunks || [])
    .map((id: string) => chunkMap.get(id))
    .filter(Boolean);
  const hasChildren = subChunks.length > 0;

  return (
    <div style={{ marginLeft: depth * 20 }}>
      <div className={`border rounded-md px-3 py-2 mb-1 ${colorClass}`}>
        <div className="flex items-center gap-2">
          {hasChildren && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-xs opacity-60 hover:opacity-100"
            >
              {expanded ? "▼" : "▶"}
            </button>
          )}
          <span className="text-xs font-mono font-medium">{chunk.id}</span>
          <span className="text-xs px-1.5 py-0.5 rounded bg-white/50">{chunk.entry_type}</span>
          {chunk.branch_label && (
            <span className="text-xs italic">"{chunk.branch_label}"</span>
          )}
          {chunk.fork_type && (
            <span className="text-xs opacity-70">fork: {chunk.fork_type}</span>
          )}
          {chunk.termination_type && (
            <span className="text-xs opacity-70">→ {chunk.termination_type}</span>
          )}
        </div>
        {chunk.narration && (
          <div className="text-xs mt-1 opacity-70 truncate max-w-xl">
            {chunk.narration.substring(0, 120)}...
          </div>
        )}
      </div>
      {expanded &&
        subChunks.map((sub: any) => (
          <ChunkNode key={sub.id} chunk={sub} chunkMap={chunkMap} depth={depth + 1} />
        ))}
    </div>
  );
}

export function ChunkTree({ chunks }: Props) {
  if (!chunks || chunks.length === 0)
    return <div className="text-sm text-gray-500">No chunk data</div>;

  const chunkMap = new Map(chunks.map((c: any) => [c.id, c]));
  const rootChunks = chunks.filter((c: any) => !c.parent_chunk_id);

  return (
    <div className="space-y-1">
      {rootChunks.map(c => (
        <ChunkNode key={c.id} chunk={c} chunkMap={chunkMap} depth={0} />
      ))}
    </div>
  );
}
