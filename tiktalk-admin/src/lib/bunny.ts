// Bunny Stream client.
//
// Pipeline uploads lesson MP4s here (not Bunny Storage). Backend signs
// playback + thumbnail URLs at read time using the same library ID, so
// the pipeline's only job is to produce a `bunny_video_id` (guid).

const LIBRARY_ID = process.env.BUNNY_LIBRARY_ID!;
const API_KEY = process.env.BUNNY_API_KEY!;
const API_BASE = "https://video.bunnycdn.com";

const STATUS_FINISHED = 4;
const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS = 300_000; // 5 min max

type VideoMeta = {
  guid: string;
  status: number;
  length: number;
  width: number;
  height: number;
};

/**
 * Upload a lesson MP4 to Bunny Stream.
 * 1) create video shell → guid
 * 2) PUT binary → Bunny transcodes async
 * 3) poll until status=FINISHED
 *
 * Returns the Bunny guid — store in lessons.bunny_video_id.
 */
export async function uploadLessonVideo(
  buffer: Buffer,
  title: string
): Promise<string> {
  // 1) create shell
  const createRes = await fetch(
    `${API_BASE}/library/${LIBRARY_ID}/videos`,
    {
      method: "POST",
      headers: {
        AccessKey: API_KEY,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ title }),
    }
  );
  if (!createRes.ok) {
    throw new Error(
      `Bunny create video failed: ${createRes.status} ${await createRes.text()}`
    );
  }
  const created = (await createRes.json()) as { guid?: string };
  const guid = created.guid;
  if (!guid) {
    throw new Error(`Bunny create video: no guid in response`);
  }

  // 2) upload binary
  const uploadRes = await fetch(
    `${API_BASE}/library/${LIBRARY_ID}/videos/${guid}`,
    {
      method: "PUT",
      headers: {
        AccessKey: API_KEY,
        "Content-Type": "application/octet-stream",
      },
      body: new Uint8Array(buffer),
    }
  );
  if (!uploadRes.ok) {
    throw new Error(
      `Bunny upload binary failed: ${uploadRes.status} ${await uploadRes.text()}`
    );
  }

  // 3) wait until transcoded — Bunny processes async
  const start = Date.now();
  while (Date.now() - start < POLL_TIMEOUT_MS) {
    await sleep(POLL_INTERVAL_MS);
    const meta = await getVideoMeta(guid);
    if (meta.status === STATUS_FINISHED) {
      return guid;
    }
    // status values: 0=created 1=uploaded 2=processing 3=transcoding 4=finished 5=error 6=uploadfailed
    if (meta.status === 5 || meta.status === 6) {
      throw new Error(`Bunny transcoding failed: status=${meta.status}`);
    }
  }
  throw new Error(`Bunny transcoding timed out after ${POLL_TIMEOUT_MS}ms`);
}

/**
 * Replace the auto-generated thumbnail with a custom one (PNG or JPG).
 * Bunny renames thumbnailFileName on custom upload, which the backend
 * reads via the video meta endpoint if it needs the actual filename.
 */
export async function setCustomThumbnail(
  guid: string,
  imageBuffer: Buffer,
  mime: "image/jpeg" | "image/png" = "image/jpeg"
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/library/${LIBRARY_ID}/videos/${guid}/thumbnail`,
    {
      method: "POST",
      headers: {
        AccessKey: API_KEY,
        "Content-Type": mime,
      },
      body: new Uint8Array(imageBuffer),
    }
  );
  if (!res.ok) {
    throw new Error(
      `Bunny set thumbnail failed: ${res.status} ${await res.text()}`
    );
  }
}

/** Fetch video metadata — used to poll transcoding state + verify length. */
export async function getVideoMeta(guid: string): Promise<VideoMeta> {
  const res = await fetch(
    `${API_BASE}/library/${LIBRARY_ID}/videos/${guid}`,
    {
      headers: { AccessKey: API_KEY, Accept: "application/json" },
    }
  );
  if (!res.ok) {
    throw new Error(`Bunny get meta failed: ${res.status}`);
  }
  return (await res.json()) as VideoMeta;
}

/** Delete a video from the library (used when we reject a generation). */
export async function deleteVideo(guid: string): Promise<void> {
  const res = await fetch(
    `${API_BASE}/library/${LIBRARY_ID}/videos/${guid}`,
    {
      method: "DELETE",
      headers: { AccessKey: API_KEY },
    }
  );
  if (!res.ok && res.status !== 404) {
    throw new Error(`Bunny delete failed: ${res.status}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
