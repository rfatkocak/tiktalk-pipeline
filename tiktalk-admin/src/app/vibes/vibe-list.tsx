"use client";

import { useState } from "react";
import { createVibe, deleteVibe } from "./actions";

interface Vibe {
  id: string;
  slug: string;
  name: string;
  prompt_hint: string | null;
  created_at: string;
}

export function VibeList({ vibes }: { vibes: Vibe[] }) {
  const [showForm, setShowForm] = useState(false);

  return (
    <div>
      <button
        onClick={() => setShowForm(!showForm)}
        className="mb-4 px-4 py-2 bg-zinc-900 text-white text-sm rounded-md hover:bg-zinc-800 transition-colors"
      >
        {showForm ? "Cancel" : "New Vibe"}
      </button>

      {showForm && (
        <form
          action={async (formData) => {
            await createVibe(formData);
            setShowForm(false);
          }}
          className="mb-6 bg-white border border-zinc-200 rounded-lg p-5 space-y-3"
        >
          <div className="grid grid-cols-2 gap-3">
            <input
              name="name"
              placeholder="Name (e.g. Anime)"
              required
              className="px-3 py-2 border border-zinc-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-zinc-400"
            />
            <input
              name="slug"
              placeholder="Slug (e.g. anime)"
              required
              className="px-3 py-2 border border-zinc-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-zinc-400"
            />
          </div>
          <textarea
            name="prompt_hint"
            placeholder="Prompt hint (style instruction for Seedance)"
            rows={2}
            className="w-full px-3 py-2 border border-zinc-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-zinc-400"
          />
          <button
            type="submit"
            className="px-4 py-2 bg-zinc-900 text-white text-sm rounded-md hover:bg-zinc-800 transition-colors"
          >
            Create
          </button>
        </form>
      )}

      <div className="space-y-2">
        {vibes.length === 0 && (
          <p className="text-sm text-zinc-400">No vibes yet.</p>
        )}
        {vibes.map((v) => (
          <div
            key={v.id}
            className="flex items-center justify-between bg-white border border-zinc-200 rounded-lg px-5 py-3"
          >
            <div>
              <p className="text-sm font-medium">{v.name}</p>
              <p className="text-xs text-zinc-400">
                {v.slug}
                {v.prompt_hint && ` — ${v.prompt_hint.substring(0, 60)}...`}
              </p>
            </div>
            <button
              onClick={() => deleteVibe(v.id)}
              className="text-xs text-zinc-400 hover:text-red-500 transition-colors"
            >
              Delete
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
