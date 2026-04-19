"use server";

import { query } from "@/lib/db";
import { deleteFromBunny } from "@/lib/bunny";
import { revalidatePath } from "next/cache";

export async function createChannel(formData: FormData) {
  const name = formData.get("name") as string;
  const slug = formData.get("slug") as string;
  const description = formData.get("description") as string;
  const avatar_url = formData.get("avatar_url") as string;

  await query(
    `INSERT INTO channels (name, slug, description, avatar_url)
     VALUES ($1, $2, $3, $4)`,
    [name, slug, description || null, avatar_url || null]
  );

  revalidatePath("/channels");
}

export async function updateChannel(formData: FormData) {
  const id = formData.get("id") as string;
  const name = formData.get("name") as string;
  const slug = formData.get("slug") as string;
  const description = formData.get("description") as string;
  const avatar_url = formData.get("avatar_url") as string;
  const old_avatar_url = formData.get("old_avatar_url") as string;

  // Yeni avatar yüklendiyse eskisini Bunny'den sil
  if (avatar_url && old_avatar_url && avatar_url !== old_avatar_url) {
    const path = extractBunnyPath(old_avatar_url);
    if (path) await deleteFromBunny(path).catch(() => {});
  }

  await query(
    `UPDATE channels SET name = $1, slug = $2, description = $3, avatar_url = $4 WHERE id = $5`,
    [name, slug, description || null, avatar_url || null, id]
  );

  revalidatePath("/channels");
}

export async function deleteChannel(id: string) {
  // Önce avatar'ı Bunny'den sil
  const res = await query("SELECT avatar_url FROM channels WHERE id = $1", [id]);
  const avatarUrl = res.rows[0]?.avatar_url;
  if (avatarUrl) {
    const path = extractBunnyPath(avatarUrl);
    if (path) await deleteFromBunny(path).catch(() => {});
  }

  await query("DELETE FROM channels WHERE id = $1", [id]);
  revalidatePath("/channels");
}

function extractBunnyPath(url: string): string | null {
  try {
    const u = new URL(url);
    return u.pathname.slice(1); // başındaki / 'yi kaldır
  } catch {
    return null;
  }
}
