"use server";

import { query } from "@/lib/db";
import { revalidatePath } from "next/cache";

export async function createVibe(formData: FormData) {
  const name = formData.get("name") as string;
  const slug = formData.get("slug") as string;
  const prompt_hint = formData.get("prompt_hint") as string;

  await query(
    `INSERT INTO vibes (name, slug, prompt_hint) VALUES ($1, $2, $3)`,
    [name, slug, prompt_hint || null]
  );

  revalidatePath("/vibes");
}

export async function deleteVibe(id: string) {
  await query("DELETE FROM vibes WHERE id = $1", [id]);
  revalidatePath("/vibes");
}
