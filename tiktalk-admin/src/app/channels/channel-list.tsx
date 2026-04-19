"use client";

import { useState, useRef } from "react";
import { createChannel, updateChannel, deleteChannel } from "./actions";

// New schema: channels(name, handle CITEXT UNIQUE, description, avatar_emoji,
// avatar_bunny_video_id, target_language). Avatar can be an emoji OR a Bunny
// Stream asset (photo uploaded via /api/upload-channel-avatar). Backend signs
// the CDN URL and returns it as channel.avatarUrl.

interface Channel {
  id: string;
  handle: string;
  name: string;
  description: string | null;
  avatar_emoji: string | null;
  avatar_bunny_video_id: string | null;
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

async function uploadAvatar(file: File): Promise<string> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/upload-channel-avatar", {
    method: "POST",
    body: fd,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `upload failed (HTTP ${res.status})`);
  }
  const { guid } = (await res.json()) as { guid: string };
  return guid;
}

export function ChannelList({ channels }: { channels: Channel[] }) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // --- Create form state ---
  const [avatarEmoji, setAvatarEmoji] = useState("");
  const [avatarGuid, setAvatarGuid] = useState("");
  const [avatarPreview, setAvatarPreview] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // --- Edit form state ---
  const [editName, setEditName] = useState("");
  const [editHandle, setEditHandle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editAvatarEmoji, setEditAvatarEmoji] = useState("");
  const [editAvatarGuid, setEditAvatarGuid] = useState(""); // empty = keep existing
  const [editAvatarPreview, setEditAvatarPreview] = useState("");
  const [editUploading, setEditUploading] = useState(false);
  const editFileRef = useRef<HTMLInputElement>(null);

  async function handleFileCreate(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarPreview(URL.createObjectURL(file));
    setUploading(true);
    try {
      const guid = await uploadAvatar(file);
      setAvatarGuid(guid);
    } catch (err) {
      alert("Upload hata: " + (err as Error).message);
      setAvatarPreview("");
    }
    setUploading(false);
  }

  async function handleFileEdit(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setEditAvatarPreview(URL.createObjectURL(file));
    setEditUploading(true);
    try {
      const guid = await uploadAvatar(file);
      setEditAvatarGuid(guid);
    } catch (err) {
      alert("Upload hata: " + (err as Error).message);
      setEditAvatarPreview("");
    }
    setEditUploading(false);
  }

  function startEdit(ch: Channel) {
    setEditingId(ch.id);
    setEditName(ch.name);
    setEditHandle(ch.handle);
    setEditDescription(ch.description || "");
    setEditAvatarEmoji(ch.avatar_emoji || "");
    setEditAvatarGuid("");
    setEditAvatarPreview("");
  }

  function cancelEdit() {
    setEditingId(null);
    setEditAvatarGuid("");
    setEditAvatarPreview("");
  }

  function resetCreate() {
    setShowForm(false);
    setAvatarEmoji("");
    setAvatarGuid("");
    setAvatarPreview("");
  }

  return (
    <div>
      <button
        onClick={() => (showForm ? resetCreate() : setShowForm(true))}
        className="mb-4 px-4 py-2 bg-zinc-900 text-white text-sm rounded-md hover:bg-zinc-800 transition-colors"
      >
        {showForm ? "Cancel" : "New Channel"}
      </button>

      {showForm && (
        <form
          action={async (formData) => {
            formData.set("avatar_emoji", avatarEmoji);
            formData.set("avatar_bunny_video_id", avatarGuid);
            await createChannel(formData);
            resetCreate();
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
              placeholder="Fallback emoji (örn. 🎙️)"
              maxLength={4}
              value={avatarEmoji}
              onChange={(e) => setAvatarEmoji(e.target.value)}
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

          {/* Avatar photo upload */}
          <div>
            <p className="text-xs text-zinc-500 mb-1.5">Avatar photo (opsiyonel — emoji yerine gerçek fotoğraf)</p>
            <div className="flex items-center gap-3">
              {avatarPreview ? (
                <img
                  src={avatarPreview}
                  alt="Preview"
                  className="w-12 h-12 rounded-full object-cover border border-zinc-200"
                />
              ) : (
                <div className="w-12 h-12 rounded-full bg-zinc-100 border border-zinc-200 flex items-center justify-center text-lg">
                  {avatarEmoji || "🎬"}
                </div>
              )}
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="px-3 py-1.5 border border-zinc-200 rounded-md text-sm text-zinc-600 hover:bg-zinc-50 transition-colors disabled:opacity-50"
              >
                {uploading ? "Uploading…" : avatarGuid ? "Change photo" : "Choose photo"}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png"
                onChange={handleFileCreate}
                className="hidden"
              />
              {avatarGuid && (
                <span className="text-xs text-green-600 font-mono">✓ {avatarGuid.slice(0, 8)}…</span>
              )}
            </div>
          </div>

          <button
            type="submit"
            disabled={uploading}
            className="px-4 py-2 bg-zinc-900 text-white text-sm rounded-md hover:bg-zinc-800 transition-colors disabled:opacity-50"
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
                formData.set("avatar_emoji", editAvatarEmoji);
                formData.set("avatar_bunny_video_id", editAvatarGuid);
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
                value={editAvatarEmoji}
                onChange={(e) => setEditAvatarEmoji(e.target.value)}
                placeholder="Fallback emoji"
                maxLength={4}
                className="w-full px-3 py-2 border border-zinc-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-zinc-400"
              />

              {/* Avatar photo edit */}
              <div>
                <p className="text-xs text-zinc-500 mb-1.5">Avatar photo (yeni yüklersen eskisi replace olur)</p>
                <div className="flex items-center gap-3">
                  {editAvatarPreview ? (
                    <img src={editAvatarPreview} alt="Preview" className="w-12 h-12 rounded-full object-cover border border-zinc-200" />
                  ) : ch.avatar_bunny_video_id ? (
                    <div className="w-12 h-12 rounded-full bg-zinc-100 border border-zinc-200 flex items-center justify-center text-[10px] text-zinc-400 font-mono">
                      {ch.avatar_bunny_video_id.slice(0, 6)}…
                    </div>
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-zinc-100 border border-zinc-200 flex items-center justify-center text-lg">
                      {editAvatarEmoji || "🎬"}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => editFileRef.current?.click()}
                    disabled={editUploading}
                    className="px-3 py-1.5 border border-zinc-200 rounded-md text-sm text-zinc-600 hover:bg-zinc-50 transition-colors disabled:opacity-50"
                  >
                    {editUploading ? "Uploading…" : "Change photo"}
                  </button>
                  <input
                    ref={editFileRef}
                    type="file"
                    accept="image/jpeg,image/png"
                    onChange={handleFileEdit}
                    className="hidden"
                  />
                  {editAvatarGuid && (
                    <span className="text-xs text-green-600 font-mono">✓ {editAvatarGuid.slice(0, 8)}…</span>
                  )}
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={editUploading}
                  className="px-4 py-2 bg-zinc-900 text-white text-sm rounded-md hover:bg-zinc-800 transition-colors disabled:opacity-50"
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
                  {ch.avatar_bunny_video_id ? "📷" : ch.avatar_emoji || "🎬"}
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
