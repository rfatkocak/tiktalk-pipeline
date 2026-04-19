"use server";

import { query } from "@/lib/db";
import { revalidatePath } from "next/cache";

// Schema (backend 0002_content + 0005_asset_video_ids):
//   channels(id, name, handle CITEXT UNIQUE, avatar_emoji, description,
//            target_language, avatar_bunny_video_id)
//
// Avatars can be set two ways:
//   - avatar_emoji       → quick/placeholder ("🎙️"), shown as-is
//   - avatar_bunny_video_id → real photo, uploaded via /api/upload-channel-avatar.
//     Backend signs the Bunny Stream thumbnail URL at read time.
// A channel can have both; iOS prefers the real photo (avatarUrl) over emoji.

export async function createChannel(formData: FormData) {
  const name = formData.get("name") as string;
  const handle = formData.get("handle") as string;
  const description = formData.get("description") as string;
  const avatar_emoji = formData.get("avatar_emoji") as string;
  const avatar_bunny_video_id = formData.get("avatar_bunny_video_id") as string;
  const target_language = (formData.get("target_language") as string) || "en";

  await query(
    `INSERT INTO channels (name, handle, description, avatar_emoji, avatar_bunny_video_id, target_language)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      name,
      handle,
      description || null,
      avatar_emoji || null,
      avatar_bunny_video_id || null,
      target_language,
    ]
  );

  revalidatePath("/channels");
}

export async function updateChannel(formData: FormData) {
  const id = formData.get("id") as string;
  const name = formData.get("name") as string;
  const handle = formData.get("handle") as string;
  const description = formData.get("description") as string;
  const avatar_emoji = formData.get("avatar_emoji") as string;
  const avatar_bunny_video_id = formData.get("avatar_bunny_video_id") as string;

  // avatar_bunny_video_id handling: empty string = "no change", "clear" marker
  // would need explicit UI. Keep existing if unchanged, overwrite if supplied.
  if (avatar_bunny_video_id) {
    await query(
      `UPDATE channels
         SET name = $1, handle = $2, description = $3,
             avatar_emoji = $4, avatar_bunny_video_id = $5
       WHERE id = $6`,
      [
        name,
        handle,
        description || null,
        avatar_emoji || null,
        avatar_bunny_video_id,
        id,
      ]
    );
  } else {
    await query(
      `UPDATE channels
         SET name = $1, handle = $2, description = $3, avatar_emoji = $4
       WHERE id = $5`,
      [name, handle, description || null, avatar_emoji || null, id]
    );
  }

  revalidatePath("/channels");
}

export async function deleteChannel(id: string) {
  await query("DELETE FROM channels WHERE id = $1", [id]);
  revalidatePath("/channels");
}
