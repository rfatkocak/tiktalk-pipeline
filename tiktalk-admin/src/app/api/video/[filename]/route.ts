import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const DOWNLOAD_DIR = path.join(process.cwd(), "..", "seedance-automation", "downloads");

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params;
  const filePath = path.join(DOWNLOAD_DIR, filename);

  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const stat = fs.statSync(filePath);
  const stream = fs.readFileSync(filePath);

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": stat.size.toString(),
    },
  });
}
