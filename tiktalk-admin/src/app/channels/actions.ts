"use server";

import { query } from "@/lib/db";
import { revalidatePath } from "next/cache";

// New schema (backend 0002_content):
//   channels(id, name, handle CITEXT UNIQUE, avatar_emoji, description,
//            target_language, avatar_bunny_video_id)
// Bunny-Storage avatar URLs are gone — channels now use either an emoji or
// a Bunny Stream video guid (signed at read time by the backend).

export async function createChannel(formData: FormData) {
  const name = formData.get("name") as string;
  const handle = formData.get("handle") as string;
  const description = formData.get("description") as string;
  const avatar_emoji = formData.get("avatar_emoji") as string;
  const target_language = (formData.get("target_language") as string) || "en";

  await query(
    `INSERT INTO channels (name, handle, description, avatar_emoji, target_language)
     VALUES ($1, $2, $3, $4, $5)`,
    [name, handle, description || null, avatar_emoji || null, target_language]
  );

  revalidatePath("/channels");
}

export async function updateChannel(formData: FormData) {
  const id = formData.get("id") as string;
  const name = formData.get("name") as string;
  const handle = formData.get("handle") as string;
  const description = formData.get("description") as string;
  const avatar_emoji = formData.get("avatar_emoji") as string;

  await query(
    `UPDATE channels
       SET name = $1, handle = $2, description = $3, avatar_emoji = $4
     WHERE id = $5`,
    [name, handle, description || null, avatar_emoji || null, id]
  );

  revalidatePath("/channels");
}

export async function deleteChannel(id: string) {
  await query("DELETE FROM channels WHERE id = $1", [id]);
  revalidatePath("/channels");
}
