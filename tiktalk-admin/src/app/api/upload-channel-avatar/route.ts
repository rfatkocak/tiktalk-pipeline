// POST /api/upload-channel-avatar
//
// Form-data: { file: <image> }
// Response:  { guid: "<bunny-stream-guid>" }
//
// Upload an image and get back a Bunny Stream guid you can save into
// channels.avatar_bunny_video_id. Backend signs the CDN thumbnail URL at
// read time — iOS sees `channel.avatarUrl` as a normal signed image URL.

import { NextRequest, NextResponse } from "next/server";
import { uploadChannelAvatar } from "@/lib/bunny";

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB — plenty for an avatar

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file field required" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `file too large: ${file.size} > ${MAX_BYTES}` },
      { status: 413 }
    );
  }

  const mime = file.type === "image/png" ? "image/png" : "image/jpeg";
  const buffer = Buffer.from(await file.arrayBuffer());
  const title = `channel-${Date.now().toString(36)}`;

  try {
    const { guid, thumbnailFileName } = await uploadChannelAvatar(buffer, title, mime);
    return NextResponse.json({ guid, thumbnailFileName });
  } catch (err) {
    return NextResponse.json(
      { error: "upload failed: " + (err as Error).message },
      { status: 500 }
    );
  }
}
