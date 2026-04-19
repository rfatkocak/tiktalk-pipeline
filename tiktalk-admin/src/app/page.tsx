import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const channels = await query("SELECT COUNT(*) FROM channels");
  const vibes = await query("SELECT COUNT(*) FROM vibes");
  const tps = await query("SELECT COUNT(*) FROM teaching_points");
  const videos = await query("SELECT COUNT(*) FROM videos");

  const stats = [
    { label: "Channels", value: channels.rows[0].count },
    { label: "Vibes", value: vibes.rows[0].count },
    { label: "Teaching Points", value: tps.rows[0].count },
    { label: "Videos", value: videos.rows[0].count },
  ];

  return (
    <div>
      <h2 className="text-xl font-semibold mb-6">Dashboard</h2>
      <div className="grid grid-cols-4 gap-4">
        {stats.map((s) => (
          <div
            key={s.label}
            className="bg-white border border-zinc-200 rounded-lg p-5"
          >
            <p className="text-sm text-zinc-400">{s.label}</p>
            <p className="text-2xl font-semibold mt-1">{s.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
