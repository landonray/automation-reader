# Clickable Chunk Tree with Detail Panel

**Date:** 2026-04-16
**Scope:** Frontend-only change to the Reader Workbench chunk tree view

## Goal

Let the user click a chunk in the Chunk Tree to see the elements (nodes) contained in that chunk and the LLM-generated descriptions for that chunk, without leaving the current results view.

## Motivation

The chunk tree currently shows structural information (id, entry type, branch label, fork type, termination type) and a 120-character preview of the narration. The full LLM output and the resolved list of nodes belonging to each chunk are already produced by the pipeline and sent to the client, but there is no way to inspect them per chunk. This change exposes that data.

## Non-Goals

- No changes to the pipeline, narrator, database schema, or API.
- No new endpoints. All required data is already in the existing `/api/runs/:id/results/:resultId` response.
- No graph visualization of chunk nodes in this pass (could be added later).
- No display of raw Ontraport `resource` JSON per node in this pass. Label + type + timing only.

## Affected Files

- `client/components/ChunkTree.tsx` — all changes live in this file.

The component is rendered from `client/pages/RunDashboard.tsx` at line 365 with a single `chunks` prop. The prop interface does not change.

## Existing Data Used

Each chunk object already carries:

- `id`, `entry_type`, `branch_label`, `fork_type`, `termination_type`, `total_duration` (structural metadata used in summary header)
- `node_details: NodeDetail[]` — resolved nodes in sequence order, each with `id`, `type`, `label`, `resource`, `cumulative_elapsed`
- `narration?: string` — simple prose narration
- `chunk_narration?: ChunkNarration` — structured narration with `prose`, `entities_mentioned`, `wait_description`, `end_mode`, `end_target`, `goto_target_description`, `condition_description`, `is_deterministic`
- `structural_warnings?: StructuralWarning[]` — any warnings attached to the chunk

No backend changes are needed.

## UX

### Layout

Inside the existing "Chunk Tree" collapsible section, render a two-column layout:

- **Left column (tree):** the current tree, with each chunk row made clickable.
- **Right column (detail panel):** details for the currently selected chunk. The panel is sticky at the top of the section so it stays visible while the user scrolls the tree.

On narrow viewports (below the layout's breakpoint — use Tailwind's `md:` breakpoint as the default, matching the rest of the workbench), the panel stacks below the tree.

When nothing is selected, the panel shows a placeholder: **"Select a chunk to see details."**

### Tree row behavior

- Clicking the chunk row selects that chunk. Clicking the same chunk again does not toggle selection off; the panel always shows a selected chunk once the user has engaged.
- The existing ▼/▶ expand/collapse button remains independent. Clicking it expands/collapses children only — it does not change the selection. The click handler on the row must stop propagation correctly so the two controls do not fight.
- Hover state: subtle brightness change and `cursor-pointer` on the chunk row so it is discoverable as clickable.
- Selected state: a visible ring (`ring-2 ring-blue-500`) added on top of the existing type-based background color. The ring must be visible for all `TYPE_COLORS` variants.
- Initial state on load: nothing selected.

### Detail panel contents

Three stacked sections inside the panel, each with a clear section heading.

**1. Summary header**

A compact header showing the chunk's structural metadata, uncondensed:

- Chunk ID (monospace)
- `entry_type` badge (colored to match the tree row)
- `branch_label` (if present, in quotes)
- `fork_type` (if present)
- `termination_type` (if present)
- `total_duration` rendered as a human-readable duration (e.g., "3d 2h 15m"). If all fields are zero, render "0".

**2. LLM Description**

- The full `narration` string, rendered with preserved line breaks, no truncation.
- Below it, when `chunk_narration` is present, a list of labeled fields. Only render fields that are populated:
  - **Condition:** `chunk_narration.condition_description`
  - **Wait:** `chunk_narration.wait_description`
  - **End mode:** `chunk_narration.end_mode` (with `end_target` appended in parens if present)
  - **Goto target:** `chunk_narration.goto_target_description`
  - **Entities mentioned:** `chunk_narration.entities_mentioned` as small chips (one per entity)
  - **Deterministic:** "Yes" or "No" based on `chunk_narration.is_deterministic`
- If neither `narration` nor `chunk_narration` is present, render: **"No narration generated for this chunk."**

**3. Elements in this chunk**

An ordered list of `node_details` in sequence order. Each row shows:

- Position number (1-indexed)
- Node label
- Node type as a small badge
- `cumulative_elapsed` rendered as a human-readable duration, right-aligned

If `structural_warnings` is present and non-empty, render a warning callout above the elements list listing each warning's message.

## Implementation Notes

- Selection state is a single `selectedChunkId: string | null` held in the `ChunkTree` component (not in `ChunkNode`). Pass `selectedChunkId` and `onSelect` down to `ChunkNode`.
- Create a new internal component `ChunkDetailPanel` in the same file that takes the selected chunk object and renders the three sections. Keep it in the same file unless it grows past ~150 lines, in which case split it out.
- A small `formatDuration(d: Duration): string` helper is needed for total_duration and cumulative_elapsed. Keep it local to the file.
- No new dependencies. Use Tailwind classes consistent with the existing file.
- The `chunks` prop already comes in as `any[]`; keep that loose typing to match the current file rather than introducing a typed import from `server/reader/types.ts`.

## Testing

Manual verification on an existing run result with a non-trivial chunk tree:

- Click a trigger chunk, a fork_branch chunk, and a goal chunk. Verify panel updates each time.
- Click the expand/collapse button. Verify selection does not change and children toggle.
- Click a chunk that has `chunk_narration` with multiple populated fields. Verify each labeled line renders.
- Click a chunk with `structural_warnings`. Verify the callout renders above the elements list.
- Click a chunk with no `narration` or `chunk_narration`. Verify the "No narration generated" placeholder renders.
- Resize the viewport to narrow. Verify the panel stacks below the tree.
- Reload the page. Verify nothing is selected initially and the placeholder shows.

No automated tests are added in this pass — the component currently has none and the change is contained to presentation.
