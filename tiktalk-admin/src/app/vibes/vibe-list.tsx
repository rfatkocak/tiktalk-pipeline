"use client";

import { useState, useMemo } from "react";
import { createVibe, deleteVibe, importVibes, type VibeImportResult } from "./actions";

interface Vibe {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  prompt_hint: string | null;
  group_name: string | null;
  created_at: string;
}

const UNGROUPED = "Other";

// Sample JSON shown in the import textarea as placeholder so the user
// knows the accepted shape at a glance.
const SAMPLE_IMPORT_JSON = JSON.stringify(
  [
    {
      group: "Aesthetic",
      slug: "neon-cyberpunk",
      name: "Neon Cyberpunk",
      description: "Neon-lit futuristic settings, rain + holograms.",
      prompt_hint:
        "Neon-lit futuristic cityscape, holographic displays, rainy night, high-tech low-life atmosphere",
    },
    {
      group: "Mood",
      slug: "cozy-sunday",
      name: "Cozy Sunday",
      description: "Warm, relaxed, homelike vibe.",
      prompt_hint: "Warm golden-hour light, soft textures, homelike comfort, plants + coffee",
    },
  ],
  null,
  2,
);

export function VibeList({ vibes }: { vibes: Vibe[] }) {
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState<VibeImportResult | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  // Group vibes by group_name so the list has visual structure. UNGROUPED
  // holds any row with group_name NULL.
  const grouped = useMemo(() => {
    const map = new Map<string, Vibe[]>();
    for (const v of vibes) {
      const g = v.group_name?.trim() || UNGROUPED;
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(v);
    }
    // Put UNGROUPED at the end; alphabetize the rest.
    const keys = [...map.keys()].sort((a, b) => {
      if (a === UNGROUPED) return 1;
      if (b === UNGROUPED) return -1;
      return a.localeCompare(b);
    });
    return keys.map((k) => ({ group: k, items: map.get(k)! }));
  }, [vibes]);

  const groupNames = useMemo(
    () => [...new Set(vibes.map((v) => v.group_name).filter(Boolean) as string[])].sort(),
    [vibes],
  );

  async function runImport() {
    if (!importText.trim()) return;
    setImportBusy(true);
    setImportResult(null);
    try {
      const r = await importVibes(importText);
      setImportResult(r);
      if (r.errors.length === 0) {
        setImportText("");
      }
    } catch (err) {
      setImportResult({
        inserted: 0,
        updated: 0,
        skipped: 0,
        errors: [(err as Error).message],
      });
    }
    setImportBusy(false);
  }

  return (
    <div>
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 bg-zinc-900 text-white text-sm rounded-md hover:bg-zinc-800 transition-colors"
        >
          {showForm ? "Cancel" : "New Vibe"}
        </button>
        <button
          onClick={() => setShowImport(!showImport)}
          className="px-4 py-2 border border-zinc-200 text-zinc-700 text-sm rounded-md hover:bg-zinc-100 transition-colors"
        >
          {showImport ? "Close Import" : "Import JSON"}
        </button>
      </div>

      {showImport && (
        <div className="mb-6 bg-white border border-zinc-200 rounded-lg p-5 space-y-3">
          <p className="text-xs text-zinc-500">
            JSON array of vibes. <code>slug</code> + <code>name</code> required. Optional:{" "}
            <code>group</code>, <code>description</code>, <code>prompt_hint</code>. Existing
            slugs are <b>updated</b>, new ones inserted.
          </p>
          <textarea
            rows={14}
            placeholder={SAMPLE_IMPORT_JSON}
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            className="w-full px-3 py-2 border border-zinc-200 rounded-md text-xs font-mono focus:outline-none focus:ring-1 focus:ring-zinc-400"
          />
          <div className="flex items-center gap-3">
            <button
              onClick={runImport}
              disabled={importBusy || !importText.trim()}
              className="px-4 py-2 bg-zinc-900 text-white text-sm rounded-md hover:bg-zinc-800 transition-colors disabled:opacity-50"
            >
              {importBusy ? "Importing…" : "Run Import"}
            </button>
            {importResult && (
              <div className="text-xs">
                <span className="text-green-600 font-medium">
                  +{importResult.inserted} new · ↻{importResult.updated} updated
                </span>
                {importResult.skipped > 0 && (
                  <span className="text-amber-600 ml-2">· {importResult.skipped} skipped</span>
                )}
                {importResult.errors.length > 0 && (
                  <div className="mt-2 text-red-600">
                    {importResult.errors.slice(0, 5).map((e, i) => (
                      <div key={i}>• {e}</div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {showForm && (
        <form
          action={async (formData) => {
            await createVibe(formData);
            setShowForm(false);
          }}
          className="mb-6 bg-white border border-zinc-200 rounded-lg p-5 space-y-3"
        >
          <div className="grid grid-cols-3 gap-3">
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
            <input
              name="group_name"
              placeholder="Group (e.g. Aesthetic)"
              list="vibe-groups"
              className="px-3 py-2 border border-zinc-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-zinc-400"
            />
            <datalist id="vibe-groups">
              {groupNames.map((g) => (
                <option key={g} value={g} />
              ))}
            </datalist>
          </div>
          <input
            name="description"
            placeholder="Short description (shown in admin + iOS)"
            className="w-full px-3 py-2 border border-zinc-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-zinc-400"
          />
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

      <div className="space-y-4">
        {vibes.length === 0 && (
          <p className="text-sm text-zinc-400">No vibes yet.</p>
        )}
        {grouped.map(({ group, items }) => {
          const collapsed = collapsedGroups[group];
          return (
            <div key={group}>
              <button
                onClick={() =>
                  setCollapsedGroups((s) => ({ ...s, [group]: !s[group] }))
                }
                className="flex items-center gap-2 mb-2 text-xs uppercase tracking-wide text-zinc-500 hover:text-zinc-800"
              >
                <span>{collapsed ? "▸" : "▾"}</span>
                <span className="font-semibold">{group}</span>
                <span className="text-zinc-400 font-normal">({items.length})</span>
              </button>
              {!collapsed && (
                <div className="space-y-2">
                  {items.map((v) => (
                    <div
                      key={v.id}
                      className="flex items-center justify-between bg-white border border-zinc-200 rounded-lg px-5 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{v.name}</p>
                        <p className="text-xs text-zinc-400 truncate">
                          <span className="font-mono">{v.slug}</span>
                          {v.description && ` — ${v.description}`}
                          {!v.description && v.prompt_hint && ` — ${v.prompt_hint.slice(0, 80)}${v.prompt_hint.length > 80 ? "…" : ""}`}
                        </p>
                      </div>
                      <button
                        onClick={() => deleteVibe(v.id)}
                        className="text-xs text-zinc-400 hover:text-red-500 transition-colors ml-4 shrink-0"
                      >
                        Delete
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
