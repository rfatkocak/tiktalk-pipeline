import { query } from "@/lib/db";
import { ChannelList } from "./channel-list";

export const dynamic = "force-dynamic";

export default async function ChannelsPage() {
  const res = await query(
    "SELECT * FROM channels ORDER BY created_at DESC"
  );

  return (
    <div>
      <h2 className="text-xl font-semibold mb-6">Channels</h2>
      <ChannelList channels={res.rows} />
    </div>
  );
}
