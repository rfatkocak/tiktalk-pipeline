"use client";

import { useState, useRef } from "react";
import { createChannel, updateChannel, deleteChannel } from "./actions";

interface Channel {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  avatar_url: string | null;
  created_at: string;
}

export function ChannelList({ channels }: { channels: Channel[] }) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState("");
  const [avatarPreview, setAvatarPreview] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const editFileRef = useRef<HTMLInputElement>(null);

  // Edit state
  const [editName, setEditName] = useState("");
  const [editSlug, setEditSlug] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editAvatarUrl, setEditAvatarUrl] = useState("");
  const [editAvatarPreview, setEditAvatarPreview] = useState("");
  const [editUploading, setEditUploading] = useState(false);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setAvatarPreview(URL.createObjectURL(file));
    setUploading(true);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("folder", "channels");

    const res = await fetch("/api/upload", { method: "POST", body: formData });
    const data = await res.json();

    if (data.url) {
      setAvatarUrl(data.url);
    }
    setUploading(false);
  }

  async function handleEditFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setEditAvatarPreview(URL.createObjectURL(file));
    setEditUploading(true);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("folder", "channels");

    const res = await fetch("/api/upload", { method: "POST", body: formData });
    const data = await res.json();

    if (data.url) {
      setEditAvatarUrl(data.url);
    }
    setEditUploading(false);
  }

  function startEdit(ch: Channel) {
    setEditingId(ch.id);
    setEditName(ch.name);
    setEditSlug(ch.slug);
    setEditDescription(ch.description || "");
    setEditAvatarUrl(ch.avatar_url || "");
    setEditAvatarPreview(ch.avatar_url || "");
  }

  function cancelEdit() {
    setEditingId(null);
    setEditAvatarUrl("");
    setEditAvatarPreview("");
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
            formData.set("avatar_url", avatarUrl);
            await createChannel(formData);
            setShowForm(false);
            setAvatarUrl("");
            setAvatarPreview("");
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
              name="slug"
              placeholder="Slug (e.g. horrorlife)"
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

          {/* Avatar upload */}
          <div>
            <p className="text-sm text-zinc-500 mb-1.5">Avatar</p>
            <div className="flex items-center gap-3">
              {avatarPreview ? (
                <img
                  src={avatarPreview}
                  alt="Preview"
                  className="w-12 h-12 rounded-full object-cover border border-zinc-200"
                />
              ) : (
                <div className="w-12 h-12 rounded-full bg-zinc-100 border border-zinc-200" />
              )}
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="px-3 py-1.5 border border-zinc-200 rounded-md text-sm text-zinc-600 hover:bg-zinc-50 transition-colors disabled:opacity-50"
              >
                {uploading ? "Uploading..." : "Choose file"}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                className="hidden"
              />
              {avatarUrl && (
                <span className="text-xs text-green-600">Uploaded</span>
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
                formData.set("avatar_url", editAvatarUrl);
                formData.set("old_avatar_url", ch.avatar_url || "");
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
                  name="slug"
                  value={editSlug}
                  onChange={(e) => setEditSlug(e.target.value)}
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

              {/* Avatar edit */}
              <div>
                <p className="text-sm text-zinc-500 mb-1.5">Avatar</p>
                <div className="flex items-center gap-3">
                  {editAvatarPreview ? (
                    <img
                      src={editAvatarPreview}
                      alt="Preview"
                      className="w-12 h-12 rounded-full object-cover border border-zinc-200"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-zinc-100 border border-zinc-200" />
                  )}
                  <button
                    type="button"
                    onClick={() => editFileRef.current?.click()}
                    disabled={editUploading}
                    className="px-3 py-1.5 border border-zinc-200 rounded-md text-sm text-zinc-600 hover:bg-zinc-50 transition-colors disabled:opacity-50"
                  >
                    {editUploading ? "Uploading..." : "Change avatar"}
                  </button>
                  <input
                    ref={editFileRef}
                    type="file"
                    accept="image/*"
                    onChange={handleEditFileChange}
                    className="hidden"
                  />
                  {editAvatarUrl && editAvatarUrl !== ch.avatar_url && (
                    <span className="text-xs text-green-600">New uploaded</span>
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
                {ch.avatar_url ? (
                  <img
                    src={ch.avatar_url}
                    alt={ch.name}
                    className="w-8 h-8 rounded-full object-cover"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-zinc-200" />
                )}
                <div>
                  <p className="text-sm font-medium">{ch.name}</p>
                  <p className="text-xs text-zinc-400">{ch.slug}</p>
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
