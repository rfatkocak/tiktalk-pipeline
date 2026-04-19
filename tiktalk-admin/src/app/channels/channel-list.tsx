"use client";

import { useState } from "react";
import { createChannel, updateChannel, deleteChannel } from "./actions";

// New schema: channels(name, handle CITEXT UNIQUE, description, avatar_emoji,
// target_language). Bunny-Storage avatar uploads are gone — channels just use
// an emoji (or, later, a Bunny Stream guid set elsewhere).

interface Channel {
  id: string;
  handle: string;
  name: string;
  description: string | null;
  avatar_emoji: string | null;
  target_language?: string | null;
  created_at: string;
}

const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "de", label: "German" },
  { code: "fr", label: "French" },
  { code: "es", label: "Spanish" },
  { code: "it", label: "Italian" },
  { code: "ja", label: "Japanese" },
];

export function ChannelList({ channels }: { channels: Channel[] }) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [editName, setEditName] = useState("");
  const [editHandle, setEditHandle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editAvatarEmoji, setEditAvatarEmoji] = useState("");

  function startEdit(ch: Channel) {
    setEditingId(ch.id);
    setEditName(ch.name);
    setEditHandle(ch.handle);
    setEditDescription(ch.description || "");
    setEditAvatarEmoji(ch.avatar_emoji || "");
  }

  function cancelEdit() {
    setEditingId(null);
  }

  return (
    <div>
      <button
        onClick={() => setShowForm(!showForm)}
        className="mb-4 px-4 py-2 bg-zinc-900 text-white text-sm rounded-md hover:bg-zinc-800 transition-colors"
      >
        {showForm ? "Cancel" : "New Channel"}
      </button>

      {showForm && (
        <form
          action={async (formData) => {
            await createChannel(formData);
            setShowForm(false);
          }}
          className="mb-6 bg-white border border-zinc-200 rounded-lg p-5 space-y-3"
        >
          <div className="grid grid-cols-2 gap-3">
            <input
              name="name"
              placeholder="Name (e.g. HORRORLiFE)"
              required
              className="px-3 py-2 border border-zinc-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-zinc-400"
            />
            <input
              name="handle"
              placeholder="Handle (e.g. horrorlife)"
              required
              className="px-3 py-2 border border-zinc-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-zinc-400"
            />
          </div>
          <textarea
            name="description"
            placeholder="Description"
            rows={2}
            className="w-full px-3 py-2 border border-zinc-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-zinc-400"
          />
          <div className="grid grid-cols-2 gap-3">
            <input
              name="avatar_emoji"
              placeholder="Avatar emoji (e.g. 🎙️)"
              maxLength={4}
              className="px-3 py-2 border border-zinc-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-zinc-400"
            />
            <select
              name="target_language"
              defaultValue="en"
              className="px-3 py-2 border border-zinc-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-zinc-400"
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  Teaches {l.label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="px-4 py-2 bg-zinc-900 text-white text-sm rounded-md hover:bg-zinc-800 transition-colors"
          >
            Create
          </button>
        </form>
      )}

      <div className="space-y-2">
        {channels.length === 0 && (
          <p className="text-sm text-zinc-400">No channels yet.</p>
        )}
        {channels.map((ch) =>
          editingId === ch.id ? (
            <form
              key={ch.id}
              action={async (formData) => {
                formData.set("id", ch.id);
                await updateChannel(formData);
                cancelEdit();
              }}
              className="bg-white border border-zinc-200 rounded-lg p-5 space-y-3"
            >
              <div className="grid grid-cols-2 gap-3">
                <input
                  name="name"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  required
                  className="px-3 py-2 border border-zinc-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-zinc-400"
                />
                <input
                  name="handle"
                  value={editHandle}
                  onChange={(e) => setEditHandle(e.target.value)}
                  required
                  className="px-3 py-2 border border-zinc-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-zinc-400"
                />
              </div>
              <textarea
                name="description"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder="Description"
                rows={2}
                className="w-full px-3 py-2 border border-zinc-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-zinc-400"
              />
              <input
                name="avatar_emoji"
                value={editAvatarEmoji}
                onChange={(e) => setEditAvatarEmoji(e.target.value)}
                placeholder="Avatar emoji"
                maxLength={4}
                className="w-full px-3 py-2 border border-zinc-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-zinc-400"
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  className="px-4 py-2 bg-zinc-900 text-white text-sm rounded-md hover:bg-zinc-800 transition-colors"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={cancelEdit}
                  className="px-4 py-2 border border-zinc-200 text-sm rounded-md text-zinc-600 hover:bg-zinc-50 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <div
              key={ch.id}
              className="flex items-center justify-between bg-white border border-zinc-200 rounded-lg px-5 py-3"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-zinc-100 border border-zinc-200 flex items-center justify-center text-base">
                  {ch.avatar_emoji || "🎬"}
                </div>
                <div>
                  <p className="text-sm font-medium">{ch.name}</p>
                  <p className="text-xs text-zinc-400">@{ch.handle}</p>
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => startEdit(ch)}
                  className="text-xs text-zinc-400 hover:text-zinc-700 transition-colors"
                >
                  Edit
                </button>
                <button
                  onClick={() => deleteChannel(ch.id)}
                  className="text-xs text-zinc-400 hover:text-red-500 transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
}
