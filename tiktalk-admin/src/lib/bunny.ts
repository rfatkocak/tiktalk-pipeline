const STORAGE_ZONE = process.env.BUNNY_STORAGE_ZONE!;
const STORAGE_KEY = process.env.BUNNY_STORAGE_KEY!;
const STORAGE_HOST = process.env.BUNNY_STORAGE_HOST!;

export async function uploadToBunny(
  file: Buffer,
  path: string
): Promise<string> {
  const url = `https://${STORAGE_HOST}/${STORAGE_ZONE}/${path}`;

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      AccessKey: STORAGE_KEY,
      "Content-Type": "application/octet-stream",
    },
    body: new Uint8Array(file),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Bunny upload failed: ${res.status} ${text}`);
  }

  return `https://tiktalk-cdn.b-cdn.net/${path}`;
}

export async function deleteFromBunny(path: string): Promise<void> {
  const url = `https://${STORAGE_HOST}/${STORAGE_ZONE}/${path}`;

  await fetch(url, {
    method: "DELETE",
    headers: { AccessKey: STORAGE_KEY },
  });
}
