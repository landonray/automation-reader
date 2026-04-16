import React, { useEffect, useState } from "react";
import { api } from "../api";

interface Note {
  id: string;
  content: string;
  layer?: string;
  createdAt: string;
}

interface Props {
  runResultId: string;
  layer?: "intent" | "behavioral_summary" | "node_details";
}

export function NotesPanel({ runResultId, layer }: Props) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [newContent, setNewContent] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadNotes();
  }, [runResultId]);

  async function loadNotes() {
    const data = await api.notes.list(runResultId);
    setNotes(layer ? data.filter((n: any) => n.layer === layer) : data);
  }

  async function handleCreate() {
    if (!newContent.trim()) return;
    setSaving(true);
    await api.notes.create({ runResultId, content: newContent.trim(), layer });
    setNewContent("");
    await loadNotes();
    setSaving(false);
  }

  async function handleUpdate(id: string) {
    if (!editContent.trim()) return;
    setSaving(true);
    await api.notes.update(id, editContent.trim());
    setEditingId(null);
    setEditContent("");
    await loadNotes();
    setSaving(false);
  }

  async function handleDelete(id: string) {
    await api.notes.delete(id);
    await loadNotes();
  }

  function startEdit(note: Note) {
    setEditingId(note.id);
    setEditContent(note.content);
  }

  return (
    <div className="border-t pt-4 mt-4">
      <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3">Notes</h3>

      <div className="space-y-3 mb-4">
        {notes.map((note) => (
          <div key={note.id} className="bg-gray-50 rounded p-3 text-sm">
            {editingId === note.id ? (
              <div>
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="w-full border rounded p-2 text-sm resize-none"
                  rows={3}
                />
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={() => handleUpdate(note.id)}
                    disabled={saving}
                    className="px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 disabled:opacity-50"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setEditingId(null)}
                    className="px-3 py-1 bg-gray-200 text-gray-700 text-xs rounded hover:bg-gray-300"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <div className="whitespace-pre-wrap text-gray-800">{note.content}</div>
                <div className="flex items-center gap-3 mt-2">
                  <span className="text-xs text-gray-400">
                    {new Date(note.createdAt).toLocaleString()}
                  </span>
                  <button
                    onClick={() => startEdit(note)}
                    className="text-xs text-blue-600 hover:text-blue-800"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(note.id)}
                    className="text-xs text-red-600 hover:text-red-800"
                  >
                    Delete
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
        {notes.length === 0 && (
          <div className="text-xs text-gray-400">No notes yet</div>
        )}
      </div>

      <div>
        <textarea
          value={newContent}
          onChange={(e) => setNewContent(e.target.value)}
          placeholder="Add a note..."
          className="w-full border rounded p-2 text-sm resize-none"
          rows={2}
        />
        <button
          onClick={handleCreate}
          disabled={saving || !newContent.trim()}
          className="mt-2 px-4 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
        >
          Add Note
        </button>
      </div>
    </div>
  );
}
