import { NextResponse } from "next/server";

// Legacy route — Bunny Storage avatar uploads are gone. Channel avatars are
// now `avatar_emoji` (text) or `avatar_bunny_video_id` (Bunny Stream guid),
// not arbitrary image URLs. Leave a 410 here so any stale client call fails
// loudly instead of silently uploading to a now-missing function.
export async function POST() {
  return NextResponse.json(
    {
      error:
        "Removed: channel avatars now use avatar_emoji or avatar_bunny_video_id. " +
        "Use the channels admin UI directly.",
    },
    { status: 410 }
  );
}
