"use server";

import { query } from "@/lib/db";
import { revalidatePath } from "next/cache";

export async function createVibe(formData: FormData) {
  const name = formData.get("name") as string;
  const slug = formData.get("slug") as string;
  const prompt_hint = formData.get("prompt_hint") as string;
  const description = formData.get("description") as string;
  const group_name = formData.get("group_name") as string;

  await query(
    `INSERT INTO vibes (name, slug, description, prompt_hint, group_name)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (slug) DO UPDATE
       SET name        = EXCLUDED.name,
           description = EXCLUDED.description,
           prompt_hint = EXCLUDED.prompt_hint,
           group_name  = EXCLUDED.group_name`,
    [
      name,
      slug,
      description || null,
      prompt_hint || null,
      group_name || null,
    ],
  );

  revalidatePath("/vibes");
}

export async function deleteVibe(id: string) {
  await query("DELETE FROM vibes WHERE id = $1", [id]);
  revalidatePath("/vibes");
}

// Upsert a batch of vibes from a JSON import. Accepted shapes:
//   [
//     { "slug": "anime", "name": "Anime", "group": "Aesthetic",
//       "description": "...", "prompt_hint": "..." },
//     ...
//   ]
// or the same array wrapped in { "vibes": [...] } / { "group": "X", "vibes": [...] }.
// Returns a summary so the UI can render a result toast.
export type VibeImportResult = {
  inserted: number;
  updated: number;
  skipped: number;
  errors: string[];
};

type VibeImportItem = {
  slug?: string;
  name?: string;
  description?: string;
  prompt_hint?: string;
  promptHint?: string;
  group?: string;
  group_name?: string;
  groupName?: string;
};

export async function importVibes(jsonText: string): Promise<VibeImportResult> {
  const result: VibeImportResult = { inserted: 0, updated: 0, skipped: 0, errors: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    result.errors.push("JSON parse error: " + (err as Error).message);
    return result;
  }

  // Normalize shapes into a flat array. Accepts:
  //   [ {...}, {...} ]
  //   { "vibes": [...] }
  //   { "group": "X", "vibes": [...] }  → group applies when item lacks one
  //   { "groups": [ { "group": "X", "vibes": [...] }, ... ] }
  const items: (VibeImportItem & { _group?: string })[] = [];
  const pushFrom = (arr: unknown, inheritedGroup?: string) => {
    if (!Array.isArray(arr)) return;
    for (const raw of arr) {
      if (!raw || typeof raw !== "object") continue;
      items.push({ ...(raw as VibeImportItem), _group: inheritedGroup });
    }
  };

  if (Array.isArray(parsed)) {
    pushFrom(parsed);
  } else if (parsed && typeof parsed === "object") {
    const p = parsed as Record<string, unknown>;
    if (Array.isArray(p.vibes)) {
      pushFrom(p.vibes, typeof p.group === "string" ? p.group : undefined);
    }
    if (Array.isArray(p.groups)) {
      for (const g of p.groups) {
        if (g && typeof g === "object") {
          const gg = g as Record<string, unknown>;
          pushFrom(gg.vibes, typeof gg.group === "string" ? gg.group : undefined);
        }
      }
    }
  }

  if (items.length === 0) {
    result.errors.push("No vibes found in JSON (expected an array or {vibes:[...]}).");
    return result;
  }

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const slug = (it.slug || "").trim().toLowerCase();
    const name = (it.name || "").trim();
    if (!slug || !name) {
      result.skipped++;
      result.errors.push(`item[${i}] missing slug or name — skipped`);
      continue;
    }
    const description = (it.description || "").trim() || null;
    const prompt_hint =
      (it.prompt_hint || it.promptHint || "").trim() || null;
    const group =
      (it.group || it.group_name || it.groupName || it._group || "").trim() || null;

    // Upsert + tell us whether it inserted or updated via xmax trick.
    const res = await query(
      `INSERT INTO vibes (slug, name, description, prompt_hint, group_name)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (slug) DO UPDATE
         SET name        = EXCLUDED.name,
             description = EXCLUDED.description,
             prompt_hint = EXCLUDED.prompt_hint,
             group_name  = EXCLUDED.group_name
       RETURNING (xmax = 0) AS inserted`,
      [slug, name, description, prompt_hint, group],
    );
    const inserted = (res.rows[0] as { inserted?: boolean } | undefined)?.inserted;
    if (inserted) result.inserted++;
    else result.updated++;
  }

  revalidatePath("/vibes");
  return result;
}
