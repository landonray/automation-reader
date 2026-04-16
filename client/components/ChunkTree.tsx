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

function formatDuration(d: any): string {
  if (!d) return "0";
  const days = d.days || 0;
  const hours = d.hours || 0;
  const minutes = d.minutes || 0;
  if (days === 0 && hours === 0 && minutes === 0) return "0";
  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  return parts.join(" ");
}

function ChunkNode({
  chunk,
  chunkMap,
  depth,
  selectedChunkId,
  onSelect,
}: {
  chunk: any;
  chunkMap: Map<string, any>;
  depth: number;
  selectedChunkId: string | null;
  onSelect: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const colorClass =
    TYPE_COLORS[chunk.entry_type] || "bg-gray-50 text-gray-700 border-gray-200";
  const subChunks = (chunk.sub_chunks || [])
    .map((id: string) => chunkMap.get(id))
    .filter(Boolean);
  const hasChildren = subChunks.length > 0;
  const isSelected = selectedChunkId === chunk.id;

  return (
    <div style={{ marginLeft: depth * 20 }}>
      <div
        onClick={() => onSelect(chunk.id)}
        className={`border rounded-md px-3 py-2 mb-1 cursor-pointer hover:brightness-95 transition ${colorClass} ${
          isSelected ? "ring-2 ring-blue-500" : ""
        }`}
      >
        <div className="flex items-center gap-2">
          {hasChildren && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(!expanded);
              }}
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
          <ChunkNode
            key={sub.id}
            chunk={sub}
            chunkMap={chunkMap}
            depth={depth + 1}
            selectedChunkId={selectedChunkId}
            onSelect={onSelect}
          />
        ))}
    </div>
  );
}

function ChunkDetailPanel({ chunk }: { chunk: any | null }) {
  if (!chunk) {
    return (
      <div className="border rounded-md bg-white p-4 text-sm text-gray-500">
        Select a chunk to see details.
      </div>
    );
  }

  const colorClass =
    TYPE_COLORS[chunk.entry_type] || "bg-gray-50 text-gray-700 border-gray-200";
  const narration = chunk.chunk_narration?.prose || chunk.narration;
  const cn = chunk.chunk_narration;
  const warnings = chunk.structural_warnings || [];
  const nodes = chunk.node_details || [];

  const hasStructuredFields =
    cn &&
    (cn.condition_description ||
      cn.wait_description ||
      cn.end_mode ||
      cn.goto_target_description ||
      (cn.entities_mentioned && cn.entities_mentioned.length > 0) ||
      typeof cn.is_deterministic === "boolean");

  return (
    <div className="border rounded-md bg-white overflow-hidden">
      {/* Summary header */}
      <div className={`px-4 py-3 border-b ${colorClass}`}>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-mono font-semibold">{chunk.id}</span>
          <span className="text-xs px-1.5 py-0.5 rounded bg-white/60">{chunk.entry_type}</span>
          {chunk.branch_label && (
            <span className="text-xs italic">"{chunk.branch_label}"</span>
          )}
          {chunk.fork_type && (
            <span className="text-xs opacity-80">fork: {chunk.fork_type}</span>
          )}
          {chunk.termination_type && (
            <span className="text-xs opacity-80">→ {chunk.termination_type}</span>
          )}
          <span className="text-xs opacity-80 ml-auto">
            duration: {formatDuration(chunk.total_duration)}
          </span>
        </div>
      </div>

      {/* LLM description */}
      <div className="px-4 py-3 border-b">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
          LLM Description
        </h4>
        {!narration && !hasStructuredFields ? (
          <div className="text-sm text-gray-500 italic">
            No narration generated for this chunk.
          </div>
        ) : (
          <>
            {narration && (
              <p className="text-sm text-gray-800 whitespace-pre-wrap">{narration}</p>
            )}
            {hasStructuredFields && (
              <div className="mt-3 space-y-1.5 text-sm">
                {cn.condition_description && (
                  <div>
                    <span className="font-medium text-gray-600">Condition:</span>{" "}
                    <span className="text-gray-800">{cn.condition_description}</span>
                  </div>
                )}
                {cn.wait_description && (
                  <div>
                    <span className="font-medium text-gray-600">Wait:</span>{" "}
                    <span className="text-gray-800">{cn.wait_description}</span>
                  </div>
                )}
                {cn.end_mode && (
                  <div>
                    <span className="font-medium text-gray-600">End mode:</span>{" "}
                    <span className="text-gray-800">
                      {cn.end_mode}
                      {cn.end_target ? ` (${cn.end_target})` : ""}
                    </span>
                  </div>
                )}
                {cn.goto_target_description && (
                  <div>
                    <span className="font-medium text-gray-600">Goto target:</span>{" "}
                    <span className="text-gray-800">{cn.goto_target_description}</span>
                  </div>
                )}
                {cn.entities_mentioned && cn.entities_mentioned.length > 0 && (
                  <div>
                    <span className="font-medium text-gray-600">Entities mentioned:</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {cn.entities_mentioned.map((e: string, i: number) => (
                        <span
                          key={i}
                          className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 border border-gray-200"
                        >
                          {e}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {typeof cn.is_deterministic === "boolean" && (
                  <div>
                    <span className="font-medium text-gray-600">Deterministic:</span>{" "}
                    <span className="text-gray-800">{cn.is_deterministic ? "Yes" : "No"}</span>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Elements */}
      <div className="px-4 py-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
          Elements in this chunk ({nodes.length})
        </h4>
        {warnings.length > 0 && (
          <div className="mb-3 border border-amber-200 bg-amber-50 text-amber-800 rounded-md px-3 py-2 text-sm">
            <div className="font-medium mb-1">Structural warnings</div>
            <ul className="list-disc pl-5 space-y-0.5">
              {warnings.map((w: any, i: number) => (
                <li key={i}>{w.message || JSON.stringify(w)}</li>
              ))}
            </ul>
          </div>
        )}
        {nodes.length === 0 ? (
          <div className="text-sm text-gray-500 italic">No elements in this chunk.</div>
        ) : (
          <ol className="space-y-1">
            {nodes.map((n: any, i: number) => (
              <li
                key={n.id || i}
                className="flex items-center gap-2 text-sm border rounded-md px-3 py-2 bg-gray-50"
              >
                <span className="text-xs text-gray-500 font-mono w-6">{i + 1}.</span>
                <span className="flex-1 truncate">{n.label || <em className="text-gray-400">unlabeled</em>}</span>
                <span className="text-xs px-1.5 py-0.5 rounded bg-white border text-gray-600">
                  {n.type}
                </span>
                <span className="text-xs text-gray-500 tabular-nums">
                  {formatDuration(n.cumulative_elapsed)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

export function ChunkTree({ chunks }: Props) {
  const [selectedChunkId, setSelectedChunkId] = useState<string | null>(null);

  if (!chunks || chunks.length === 0)
    return <div className="text-sm text-gray-500">No chunk data</div>;

  const chunkMap = new Map(chunks.map((c: any) => [c.id, c]));
  const rootChunks = chunks.filter((c: any) => !c.parent_chunk_id);
  const selectedChunk = selectedChunkId ? chunkMap.get(selectedChunkId) : null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="space-y-1">
        {rootChunks.map(c => (
          <ChunkNode
            key={c.id}
            chunk={c}
            chunkMap={chunkMap}
            depth={0}
            selectedChunkId={selectedChunkId}
            onSelect={setSelectedChunkId}
          />
        ))}
      </div>
      <div className="md:sticky md:top-4 md:self-start">
        <ChunkDetailPanel chunk={selectedChunk} />
      </div>
    </div>
  );
}
