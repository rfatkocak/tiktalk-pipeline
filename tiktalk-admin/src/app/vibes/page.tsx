import { query } from "@/lib/db";
import { VibeList } from "./vibe-list";

export const dynamic = "force-dynamic";

export default async function VibesPage() {
  const res = await query(
    `SELECT id, slug, name, description, prompt_hint, group_name, created_at
     FROM vibes
     ORDER BY COALESCE(group_name, 'zzz') ASC, name ASC`
  );

  return (
    <div>
      <h2 className="text-xl font-semibold mb-6">Vibes</h2>
      <VibeList vibes={res.rows} />
    </div>
  );
}
