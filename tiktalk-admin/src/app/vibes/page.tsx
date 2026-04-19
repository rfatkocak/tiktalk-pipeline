import { query } from "@/lib/db";
import { VibeList } from "./vibe-list";

export const dynamic = "force-dynamic";

export default async function VibesPage() {
  const res = await query("SELECT * FROM vibes ORDER BY created_at DESC");

  return (
    <div>
      <h2 className="text-xl font-semibold mb-6">Vibes</h2>
      <VibeList vibes={res.rows} />
    </div>
  );
}
