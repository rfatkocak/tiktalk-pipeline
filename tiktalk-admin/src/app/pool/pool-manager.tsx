"use client";

import { useState, useRef, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import { createPoolItem, deletePoolItem, toggleVideoStatus } from "./actions";

interface SelectOption {
  id: string;
  name: string;
  slug?: string;
  description?: string;
  prompt_hint?: string;
  category?: string;
  level?: string;
  subcategory?: string;
}

interface GenerateResult {
  selected_tp_ids: string[];
  seedance_prompt: string;
  reasoning: string;
}

interface Transcript {
  full_text: string;
  segments: { start: number; end: number; text: string; speaker?: string }[];
  language: string;
  duration: number;
}

interface PipelineLog {
  id: string;
  pool_item_id: string | null;
  phase: string;
  level: "info" | "warn" | "error";
  message: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

interface VideoContent {
  video: { id: string; title: string; description: string; slug: string; level: string; duration_sec: number; transcript_match_score: number } | null;
  subtitles: { locale: string; is_target_language: boolean; segments: string }[];
  quizzes: { quiz_order: number; quiz_type: string; question: string; options: string; correct_index: number; explanations: string }[];
  infoSections: { id: string; section_type: string; section_order: number; teaching_point_id: string | null; tp_name: string | null; locales: { locale: string; title: string; body: string }[] }[];
  speakingPrompts: { prompt_order: number; prompt_type: string; prompt_text: string; expected_text: string | null; context_hint: string | null }[];
  keywords: string[];
}

const LOCALES = ["en", "tr", "pt-BR", "es", "ja", "ko", "id", "ar", "de", "fr", "it", "ru", "pl"];
const LOCALE_LABELS: Record<string, string> = {
  en: "English", tr: "Türkçe", "pt-BR": "Português", es: "Español",
  ja: "日本語", ko: "한국어", id: "Indonesia", ar: "العربية",
  de: "Deutsch", fr: "Français", it: "Italiano", ru: "Русский", pl: "Polski",
};

interface PoolItem {
  id: string;
  channel_id: string | null;
  channel_name: string | null;
  level: string;
  status: string;
  notes: string | null;
  seedance_prompt: string | null;
  video_file: string | null;
  video_id: string | null;
  video_status: string | null;
  transcript: Transcript | null;
  vibes: { id: string; name: string }[] | null;
  tps: { id: string; name: string; category: string; level: string }[] | null;
  created_at: string;
}

export function PoolManager({
  channels,
  vibes,
  teachingPoints,
  tpUsageMap,
  poolItems,
}: {
  channels: SelectOption[];
  vibes: SelectOption[];
  teachingPoints: SelectOption[];
  tpUsageMap: Record<string, number>;
  poolItems: unknown[];
}) {
  const items = poolItems as PoolItem[];
  const [showForm, setShowForm] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState("");
  const [selectedLevel, setSelectedLevel] = useState("beginner");
  const [selectedVibes, setSelectedVibes] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [startingVideo, setStartingVideo] = useState(false);
  const [whisperLoading, setWhisperLoading] = useState<string | null>(null);
  const [contentLoading, setContentLoading] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [videoContent, setVideoContent] = useState<Record<string, VideoContent>>({});
  const [contentFetching, setContentFetching] = useState<string | null>(null);
  const [activeLocale, setActiveLocale] = useState("en");
  const [infoPreviewMode, setInfoPreviewMode] = useState<"mobile" | "raw">("mobile");
  const [pipelineStatus, setPipelineStatus] = useState<Record<string, string>>({});
  const [logs, setLogs] = useState<Record<string, PipelineLog[]>>({});
  const [logsLoading, setLogsLoading] = useState<string | null>(null);
  const pollingRef = useRef<Record<string, ReturnType<typeof setInterval>>>({});

  async function fetchLogs(poolItemId: string) {
    setLogsLoading(poolItemId);
    try {
      const res = await fetch(`/api/pipeline-logs?poolItemId=${poolItemId}&limit=100`);
      const data = await res.json();
      setLogs((prev) => ({ ...prev, [poolItemId]: data.logs || [] }));
    } catch (err) {
      console.error("Failed to fetch logs:", err);
    }
    setLogsLoading(null);
  }

  async function fetchVideoContent(videoId: string) {
    if (videoContent[videoId]) return;
    setContentFetching(videoId);
    try {
      const res = await fetch(`/api/video-content?videoId=${videoId}`);
      const data = await res.json();
      setVideoContent((prev) => ({ ...prev, [videoId]: data }));
    } catch (err) {
      console.error("Failed to fetch video content:", err);
    }
    setContentFetching(null);
  }

  // Poll for video_file then auto-run pipeline
  const startPolling = useCallback((poolItemId: string) => {
    if (pollingRef.current[poolItemId]) return;
    setPipelineStatus((prev) => ({ ...prev, [poolItemId]: "Seedance çalışıyor..." }));

    pollingRef.current[poolItemId] = setInterval(async () => {
      try {
        const res = await fetch(`/api/pool-status?id=${poolItemId}`);
        const data = await res.json();

        if (data.video_file) {
          // Video ready — stop polling, run pipeline steps one by one
          clearInterval(pollingRef.current[poolItemId]);
          delete pollingRef.current[poolItemId];

          // Step 1: Whisper
          if (!data.has_transcript) {
            setPipelineStatus((prev) => ({ ...prev, [poolItemId]: "🎙 Whisper çalışıyor..." }));
            const wRes = await fetch("/api/whisper", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ poolItemId }),
            });
            if (!wRes.ok) {
              const d = await wRes.json();
              setPipelineStatus((prev) => ({ ...prev, [poolItemId]: `Whisper hata: ${d.error}` }));
              return;
            }
          }

          // Step 2: Content generation
          if (!data.video_id) {
            setPipelineStatus((prev) => ({ ...prev, [poolItemId]: "🧠 İçerik üretiliyor..." }));
            const cRes = await fetch("/api/content", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ poolItemId }),
            });
            const cData = await cRes.json();
            if (!cRes.ok) {
              setPipelineStatus((prev) => ({ ...prev, [poolItemId]: `İçerik hata: ${cData.error}` }));
              return;
            }
            if (!cData.match) {
              setPipelineStatus((prev) => ({ ...prev, [poolItemId]: `Eşleşmedi (${cData.score}): ${cData.reason}` }));
              return;
            }
          }

          // Step 3: CDN upload
          setPipelineStatus((prev) => ({ ...prev, [poolItemId]: "☁️ CDN'e yükleniyor..." }));
          const uRes = await fetch("/api/upload-cdn", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ poolItemId }),
          });
          if (!uRes.ok) {
            const d = await uRes.json();
            setPipelineStatus((prev) => ({ ...prev, [poolItemId]: `CDN hata: ${d.error}` }));
            return;
          }

          setPipelineStatus((prev) => ({ ...prev, [poolItemId]: "✅ Tamamlandı!" }));
          setTimeout(() => window.location.reload(), 2000);
        }
      } catch {
        // Network error, keep polling
      }
    }, 5000);
  }, []);

  const statusColors: Record<string, string> = {
    pending: "bg-yellow-50 text-yellow-700 border-yellow-200",
    processing: "bg-blue-50 text-blue-700 border-blue-200",
    completed: "bg-green-50 text-green-700 border-green-200",
    failed: "bg-red-50 text-red-700 border-red-200",
  };

  async function handleGenerate() {
    if (!selectedChannel) {
      setError("Select a channel");
      return;
    }
    if (selectedVibes.length === 0) {
      setError("Select at least one vibe");
      return;
    }

    setGenerating(true);
    setError("");
    setResult(null);

    const channel = channels.find((c) => c.id === selectedChannel);
    const selectedVibeObjects = vibes.filter((v) => selectedVibes.includes(v.id));

    const levelTps = teachingPoints
      .filter((tp) => tp.level === selectedLevel && (tpUsageMap[tp.id] || 0) < 5)
      .map((tp) => ({
        id: tp.id,
        name: tp.name,
        category: tp.category,
        level: tp.level,
        usage_count: tpUsageMap[tp.id] || 0,
      }));

    if (levelTps.length === 0) {
      setError(`No available TPs for ${selectedLevel} level (all have 5+ videos)`);
      setGenerating(false);
      return;
    }

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelName: channel?.name,
          channelDescription: channel?.description,
          level: selectedLevel,
          vibeNames: selectedVibeObjects.map((v) => v.name),
          vibeHints: selectedVibeObjects.map((v) => v.prompt_hint),
          teachingPoints: levelTps,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Generation failed");
      } else {
        setResult(data);
      }
    } catch (err) {
      setError("Network error: " + (err as Error).message);
    }

    setGenerating(false);
  }

  async function handleSave() {
    if (!result) return;
    setSaving(true);

    await createPoolItem({
      channel_id: selectedChannel,
      level: selectedLevel,
      notes: result.reasoning,
      seedance_prompt: result.seedance_prompt,
      vibe_ids: selectedVibes,
      tp_ids: result.selected_tp_ids,
    });

    setSaving(false);
    setResult(null);
    setShowForm(false);
    setSelectedVibes([]);
    setSelectedChannel("");
  }

  async function startSeedance(ids: string[]) {
    setStartingVideo(true);
    try {
      const res = await fetch("/api/seedance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ poolItemIds: ids }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Failed to start");
      } else {
        // Start polling for each item — auto-runs full pipeline when video is ready
        for (const id of ids) {
          startPolling(id);
        }
        setSelectedItems([]);
      }
    } catch (err) {
      alert("Error: " + (err as Error).message);
    }
    setStartingVideo(false);
  }

  async function handleWhisper(id: string) {
    setWhisperLoading(id);
    try {
      const res = await fetch("/api/whisper", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ poolItemId: id }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Whisper failed");
      } else {
        alert("Transcript saved! Refresh to see.");
      }
    } catch (err) {
      alert("Error: " + (err as Error).message);
    }
    setWhisperLoading(null);
  }

  async function handleContentGenerate(id: string) {
    setContentLoading(id);
    try {
      const res = await fetch("/api/content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ poolItemId: id }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Content generation failed");
      } else if (!data.match) {
        alert(`Transcript mismatch (${data.score}): ${data.reason}\nPool item cancelled.`);
      } else {
        alert(`Content generated! Video: ${data.title}\nRefresh to see.`);
      }
    } catch (err) {
      alert("Error: " + (err as Error).message);
    }
    setContentLoading(null);
  }

  function toggleSelect(id: string) {
    setSelectedItems((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  }

  // Items eligible for seedance (have prompt, status is pending or failed)
  const eligibleForSeedance = items.filter(
    (i) => i.seedance_prompt && (i.status === "pending" || i.status === "failed")
  );
  const selectedEligible = selectedItems.filter((id) =>
    eligibleForSeedance.some((i) => i.id === id)
  );

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={() => {
            setShowForm(!showForm);
            setResult(null);
            setError("");
          }}
          className="px-4 py-2 bg-zinc-900 text-white text-sm rounded-md hover:bg-zinc-800 transition-colors"
        >
          {showForm ? "Cancel" : "New Pool Item"}
        </button>

        {selectedEligible.length > 0 && (
          <button
            onClick={() => startSeedance(selectedEligible)}
            disabled={startingVideo}
            className="px-4 py-2 bg-purple-600 text-white text-sm rounded-md hover:bg-purple-500 transition-colors disabled:opacity-50"
          >
            {startingVideo
              ? "Starting..."
              : `Start Seedance (${selectedEligible.length})`}
          </button>
        )}
      </div>

      {showForm && (
        <div className="mb-6 bg-white border border-zinc-200 rounded-lg p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <select
              value={selectedChannel}
              onChange={(e) => setSelectedChannel(e.target.value)}
              className="px-3 py-2 border border-zinc-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-zinc-400"
            >
              <option value="">Select channel</option>
              {channels.map((ch) => (
                <option key={ch.id} value={ch.id}>
                  {ch.name}
                </option>
              ))}
            </select>
            <select
              value={selectedLevel}
              onChange={(e) => setSelectedLevel(e.target.value)}
              className="px-3 py-2 border border-zinc-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-zinc-400"
            >
              <option value="beginner">Beginner</option>
              <option value="intermediate">Intermediate</option>
              <option value="advanced">Advanced</option>
            </select>
          </div>

          <div>
            <p className="text-sm font-medium mb-2">
              Vibes ({selectedVibes.length} selected)
            </p>
            <div className="flex flex-wrap gap-2">
              {vibes.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() =>
                    setSelectedVibes((prev) =>
                      prev.includes(v.id)
                        ? prev.filter((id) => id !== v.id)
                        : [...prev, v.id]
                    )
                  }
                  className={`px-3 py-1 rounded-full text-xs border transition-colors ${
                    selectedVibes.includes(v.id)
                      ? "bg-zinc-900 text-white border-zinc-900"
                      : "bg-white text-zinc-600 border-zinc-200 hover:border-zinc-400"
                  }`}
                >
                  {v.name}
                </button>
              ))}
              {vibes.length === 0 && (
                <p className="text-xs text-zinc-400">Create vibes first</p>
              )}
            </div>
          </div>

          <button
            onClick={handleGenerate}
            disabled={generating}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-500 transition-colors disabled:opacity-50"
          >
            {generating ? "Generating..." : "Generate with AI"}
          </button>

          {error && <p className="text-sm text-red-500">{error}</p>}

          {result && (
            <div className="space-y-3 border-t border-zinc-200 pt-4">
              <div>
                <p className="text-xs font-medium text-zinc-500 mb-1">
                  Selected Teaching Points
                </p>
                <div className="flex flex-wrap gap-1">
                  {result.selected_tp_ids.map((tpId) => {
                    const tp = teachingPoints.find((t) => t.id === tpId);
                    return tp ? (
                      <span
                        key={tpId}
                        className="px-2 py-0.5 bg-blue-50 border border-blue-200 rounded text-xs text-blue-700"
                      >
                        {tp.name}
                      </span>
                    ) : null;
                  })}
                </div>
              </div>

              <div>
                <p className="text-xs font-medium text-zinc-500 mb-1">
                  Seedance Prompt
                </p>
                <pre className="bg-zinc-50 rounded-md p-3 text-xs text-zinc-700 whitespace-pre-wrap">
                  {result.seedance_prompt}
                </pre>
              </div>

              <div>
                <p className="text-xs font-medium text-zinc-500 mb-1">
                  Reasoning
                </p>
                <p className="text-xs text-zinc-500">{result.reasoning}</p>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-4 py-2 bg-green-600 text-white text-sm rounded-md hover:bg-green-500 transition-colors disabled:opacity-50"
                >
                  {saving ? "Saving..." : "Save to Pool"}
                </button>
                <button
                  onClick={handleGenerate}
                  disabled={generating}
                  className="px-4 py-2 border border-zinc-200 text-sm rounded-md text-zinc-600 hover:bg-zinc-50 transition-colors disabled:opacity-50"
                >
                  {generating ? "Regenerating..." : "Regenerate"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Pool items list */}
      <div className="space-y-2">
        {items.length === 0 && (
          <p className="text-sm text-zinc-400">Pool is empty.</p>
        )}
        {items.map((item) => {
          const canStart =
            item.seedance_prompt &&
            (item.status === "pending" || item.status === "failed");
          const canWhisper =
            item.video_file && item.status === "completed" && !item.transcript;
          const canGenerateContent =
            item.transcript && item.status === "completed" && !item.video_id;
          const isExpanded = expandedId === item.id;

          // Progress indicators
          const steps = [
            { label: "Prompt", done: !!item.seedance_prompt },
            { label: "Video", done: !!item.video_file },
            { label: "Transcript", done: !!item.transcript },
            { label: "Content", done: !!item.video_id },
          ];

          return (
            <div
              key={item.id}
              className="bg-white border border-zinc-200 rounded-lg overflow-hidden"
            >
              {/* Summary row — always visible, clickable */}
              <div
                className="flex items-center gap-3 px-5 py-3 cursor-pointer hover:bg-zinc-50 transition-colors"
                onClick={() => {
                  const next = isExpanded ? null : item.id;
                  setExpandedId(next);
                  if (next && item.video_id) fetchVideoContent(item.video_id);
                }}
              >
                {canStart && (
                  <input
                    type="checkbox"
                    checked={selectedItems.includes(item.id)}
                    onChange={(e) => { e.stopPropagation(); toggleSelect(item.id); }}
                    onClick={(e) => e.stopPropagation()}
                    className="accent-purple-600"
                  />
                )}

                <span className={`px-2 py-0.5 rounded text-xs border shrink-0 ${statusColors[item.status] || "bg-zinc-50 text-zinc-500 border-zinc-200"}`}>
                  {item.status}
                </span>
                <span className="text-xs text-zinc-400 shrink-0">{item.level}</span>
                {item.channel_name && (
                  <span className="text-xs text-zinc-500 font-medium shrink-0">#{item.channel_name}</span>
                )}

                {/* Vibes inline */}
                {item.vibes && item.vibes.length > 0 && (
                  <div className="flex gap-1 shrink-0">
                    {item.vibes.map((v) => (
                      <span key={v.id} className="px-1.5 py-0.5 bg-zinc-100 rounded-full text-[10px] text-zinc-500">
                        {v.name}
                      </span>
                    ))}
                  </div>
                )}

                {/* TPs inline */}
                {item.tps && item.tps.length > 0 && (
                  <div className="flex gap-1 flex-wrap flex-1 min-w-0">
                    {item.tps.map((tp) => (
                      <span key={tp.id} className="px-1.5 py-0.5 bg-blue-50 border border-blue-100 rounded text-[10px] text-blue-600 truncate max-w-32">
                        {tp.name}
                      </span>
                    ))}
                  </div>
                )}

                {/* Pipeline status */}
                {pipelineStatus[item.id] && (
                  <span className="text-[11px] text-blue-600 font-medium animate-pulse shrink-0">
                    {pipelineStatus[item.id]}
                  </span>
                )}

                {/* Step progress dots */}
                <div className="flex gap-1 ml-auto shrink-0">
                  {steps.map((s, i) => (
                    <div key={i} title={s.label} className={`w-2 h-2 rounded-full ${s.done ? "bg-green-500" : "bg-zinc-200"}`} />
                  ))}
                </div>

                <span className="text-zinc-400 text-xs shrink-0">{isExpanded ? "▲" : "▼"}</span>
              </div>

              {/* Expanded detail */}
              {isExpanded && (
                <div className="border-t border-zinc-100 px-5 py-4 space-y-4">
                  {/* Action buttons */}
                  <div className="flex items-center gap-2">
                    {canStart && (
                      <button onClick={() => startSeedance([item.id])} disabled={startingVideo}
                        className="px-3 py-1.5 bg-purple-600 text-white text-xs rounded-md hover:bg-purple-500 disabled:opacity-50">
                        {startingVideo ? "Starting..." : "Start Seedance"}
                      </button>
                    )}
                    {canWhisper && (
                      <button onClick={() => handleWhisper(item.id)} disabled={whisperLoading === item.id}
                        className="px-3 py-1.5 bg-emerald-600 text-white text-xs rounded-md hover:bg-emerald-500 disabled:opacity-50">
                        {whisperLoading === item.id ? "Transcribing..." : "Whisper"}
                      </button>
                    )}
                    {canGenerateContent && (
                      <button onClick={() => handleContentGenerate(item.id)} disabled={contentLoading === item.id}
                        className="px-3 py-1.5 bg-orange-600 text-white text-xs rounded-md hover:bg-orange-500 disabled:opacity-50">
                        {contentLoading === item.id ? "Generating..." : "Generate Content"}
                      </button>
                    )}
                    {item.video_id && (
                      <>
                        {item.video_status === "published" ? (
                          <button
                            onClick={() => toggleVideoStatus(item.video_id!, "archived")}
                            className="px-3 py-1.5 bg-green-100 border border-green-300 text-green-700 text-xs rounded-md hover:bg-red-50 hover:border-red-300 hover:text-red-600 transition-colors"
                          >
                            Published — Archive?
                          </button>
                        ) : item.video_status === "archived" ? (
                          <button
                            onClick={() => toggleVideoStatus(item.video_id!, "published")}
                            className="px-3 py-1.5 bg-zinc-100 border border-zinc-300 text-zinc-500 text-xs rounded-md hover:bg-green-50 hover:border-green-300 hover:text-green-600 transition-colors"
                          >
                            Archived — Publish?
                          </button>
                        ) : (
                          <button
                            onClick={() => toggleVideoStatus(item.video_id!, "published")}
                            className="px-3 py-1.5 bg-amber-50 border border-amber-200 text-amber-700 text-xs rounded-md hover:bg-green-50 hover:border-green-300 hover:text-green-600 transition-colors"
                          >
                            {item.video_status} — Publish?
                          </button>
                        )}
                      </>
                    )}
                    <button onClick={() => deletePoolItem(item.id)}
                      className="ml-auto text-xs text-zinc-400 hover:text-red-500 transition-colors">
                      Delete
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    {/* Left column */}
                    <div className="space-y-3">
                      {/* Video */}
                      {item.video_file && (
                        <div>
                          <p className="text-xs font-medium text-zinc-500 mb-1">Video</p>
                          <video
                            src={`/api/video/${item.video_file}`}
                            controls
                            className="w-48 rounded-lg border border-zinc-200"
                          />
                          <p className="text-[10px] text-zinc-400 mt-0.5">{item.video_file}</p>
                        </div>
                      )}

                      {/* Reasoning */}
                      {item.notes && (
                        <div>
                          <p className="text-xs font-medium text-zinc-500 mb-1">Reasoning</p>
                          <p className="text-xs text-zinc-600 bg-amber-50 rounded p-2">{item.notes}</p>
                        </div>
                      )}

                      {/* Seedance prompt */}
                      {item.seedance_prompt && (
                        <div>
                          <p className="text-xs font-medium text-zinc-500 mb-1">Seedance Prompt</p>
                          <pre className="text-xs text-zinc-600 whitespace-pre-wrap bg-zinc-50 rounded p-2 max-h-40 overflow-y-auto">
                            {item.seedance_prompt}
                          </pre>
                        </div>
                      )}
                    </div>

                    {/* Right column */}
                    <div className="space-y-3">
                      {/* Transcript */}
                      {item.transcript && (
                        <div>
                          <p className="text-xs font-medium text-zinc-500 mb-1">Transcript</p>
                          <div className="bg-emerald-50 rounded p-2 space-y-0.5">
                            {item.transcript.segments.length > 0 ? (
                              item.transcript.segments.map((seg, i) => (
                                <p key={i} className="text-xs">
                                  <span className="text-emerald-600 font-mono">
                                    {(seg.start / 1000).toFixed(1)}s–{(seg.end / 1000).toFixed(1)}s
                                  </span>{" "}
                                  {seg.speaker && (
                                    <span className="text-blue-600 font-medium">{seg.speaker}: </span>
                                  )}
                                  <span className="text-zinc-700">{seg.text}</span>
                                </p>
                              ))
                            ) : (
                              <p className="text-xs text-zinc-700">{item.transcript.full_text}</p>
                            )}
                          </div>
                        </div>
                      )}

                      {/* TPs detail */}
                      {item.tps && item.tps.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-zinc-500 mb-1">Teaching Points</p>
                          <div className="space-y-1">
                            {item.tps.map((tp) => (
                              <div key={tp.id} className="text-xs bg-blue-50 rounded p-1.5">
                                <span className="text-blue-600 font-medium">{tp.name}</span>
                                <span className="text-zinc-400 ml-1">{tp.category} / {tp.level}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* ID */}
                      <p className="text-[10px] text-zinc-300 font-mono">{item.id}</p>
                    </div>
                  </div>

                  {/* === CONTENT TABS === */}
                  {item.video_id && (() => {
                    const vc = videoContent[item.video_id!];
                    if (contentFetching === item.video_id) {
                      return <p className="text-xs text-zinc-400">Loading content...</p>;
                    }
                    if (!vc) return null;

                    const subtitlesByLocale: Record<string, { start: number; end: number; text: string; speaker?: string }[]> = {};
                    for (const s of vc.subtitles) {
                      const segs = typeof s.segments === "string" ? JSON.parse(s.segments) : s.segments;
                      subtitlesByLocale[s.locale] = segs;
                    }

                    const quizExplanations = vc.quizzes.map((q) => {
                      const expl = typeof q.explanations === "string" ? JSON.parse(q.explanations) : q.explanations;
                      const opts = typeof q.options === "string" ? JSON.parse(q.options) : q.options;
                      return { ...q, explanations: expl as Record<string, string>, options: opts as string[] };
                    });

                    const infoByLocale: Record<string, { section_type: string; tp_name: string | null; title: string; body: string }[]> = {};
                    for (const sec of vc.infoSections) {
                      for (const loc of sec.locales) {
                        if (!infoByLocale[loc.locale]) infoByLocale[loc.locale] = [];
                        infoByLocale[loc.locale].push({
                          section_type: sec.section_type,
                          tp_name: sec.tp_name,
                          title: loc.title,
                          body: loc.body,
                        });
                      }
                    }

                    return (
                      <div className="border-t border-zinc-100 pt-4">
                        {/* Video metadata */}
                        {vc.video && (
                          <div className="flex items-center gap-3 mb-3">
                            <span className="text-sm font-medium text-zinc-800">{vc.video.title}</span>
                            <span className="text-[10px] text-zinc-400 font-mono">/{vc.video.slug}</span>
                            <span className="text-[10px] text-zinc-400">match: {vc.video.transcript_match_score}</span>
                            {vc.keywords.length > 0 && (
                              <div className="flex gap-1 flex-wrap">
                                {vc.keywords.map((kw) => (
                                  <span key={kw} className="px-1.5 py-0.5 bg-zinc-100 rounded text-[10px] text-zinc-500">{kw}</span>
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Speaking prompts */}
                        {vc.speakingPrompts.length > 0 && (
                          <div className="mb-3">
                            <p className="text-xs font-medium text-zinc-500 mb-1">Speaking Prompts</p>
                            <div className="space-y-1">
                              {vc.speakingPrompts.map((sp) => (
                                <div key={sp.prompt_order} className="text-xs bg-violet-50 rounded p-2">
                                  <span className="text-violet-600 font-medium">{sp.prompt_type}:</span>{" "}
                                  <span className="text-zinc-700">{sp.prompt_text}</span>
                                  {sp.expected_text && (
                                    <span className="text-zinc-400 ml-2">→ "{sp.expected_text}"</span>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Locale tabs */}
                        <div className="flex gap-1 flex-wrap mb-3">
                          {LOCALES.map((loc) => (
                            <button
                              key={loc}
                              onClick={() => setActiveLocale(loc)}
                              className={`px-2 py-1 rounded text-[11px] transition-colors ${
                                activeLocale === loc
                                  ? "bg-zinc-900 text-white"
                                  : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200"
                              }`}
                            >
                              {LOCALE_LABELS[loc] || loc}
                            </button>
                          ))}
                        </div>

                        {/* Content for active locale */}
                        <div className="space-y-3">
                          {/* Subtitles */}
                          {subtitlesByLocale[activeLocale] && (
                            <div>
                              <p className="text-xs font-medium text-zinc-500 mb-1">Subtitles — {LOCALE_LABELS[activeLocale]}</p>
                              <div className="bg-zinc-50 rounded p-2 space-y-0.5">
                                {subtitlesByLocale[activeLocale].map((seg, i) => (
                                  <p key={i} className="text-xs">
                                    <span className="text-zinc-400 font-mono">
                                      {(seg.start / 1000).toFixed(1)}s–{(seg.end / 1000).toFixed(1)}s
                                    </span>{" "}
                                    {seg.speaker && <span className="text-blue-500 font-medium">{seg.speaker}: </span>}
                                    <span className="text-zinc-700">{seg.text}</span>
                                  </p>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Quizzes */}
                          {quizExplanations.length > 0 && (
                            <div>
                              <p className="text-xs font-medium text-zinc-500 mb-1">Quizzes</p>
                              <div className="space-y-2">
                                {quizExplanations.map((q) => (
                                  <div key={q.quiz_order} className="bg-orange-50 rounded p-2 text-xs">
                                    <div className="flex items-center gap-2 mb-1">
                                      <span className="text-orange-600 font-medium">Q{q.quiz_order}</span>
                                      <span className="text-zinc-400">{q.quiz_type}</span>
                                    </div>
                                    <p className="text-zinc-700 font-medium mb-1">{q.question}</p>
                                    <div className="grid grid-cols-2 gap-1 mb-1">
                                      {q.options.map((opt: string, oi: number) => (
                                        <span key={oi} className={`px-1.5 py-0.5 rounded text-[11px] ${
                                          oi === q.correct_index
                                            ? "bg-green-100 text-green-700 font-medium"
                                            : "bg-white text-zinc-500 border border-zinc-200"
                                        }`}>
                                          {String.fromCharCode(65 + oi)}) {opt}
                                        </span>
                                      ))}
                                    </div>
                                    {q.explanations[activeLocale] && (
                                      <p className="text-zinc-600 bg-white rounded p-1.5 border border-orange-100">
                                        <span className="text-orange-500 font-medium">{LOCALE_LABELS[activeLocale]}:</span>{" "}
                                        {q.explanations[activeLocale]}
                                      </p>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Info sections */}
                          {infoByLocale[activeLocale] && infoByLocale[activeLocale].length > 0 && (
                            <div>
                              <div className="flex items-center gap-2 mb-2">
                                <p className="text-xs font-medium text-zinc-500">Info Sections ��� {LOCALE_LABELS[activeLocale]}</p>
                                <button
                                  onClick={() => setInfoPreviewMode(m => m === "raw" ? "mobile" : "raw")}
                                  className="text-[10px] px-2 py-0.5 rounded border border-zinc-200 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-50"
                                >
                                  {infoPreviewMode === "raw" ? "Mobile Preview" : "Raw"}
                                </button>
                              </div>

                              {infoPreviewMode === "mobile" ? (
                                /* Mobile preview frame */
                                <div className="mx-auto w-[340px] bg-black rounded-[32px] p-2.5 shadow-lg">
                                  <div className="bg-white rounded-[26px] overflow-hidden">
                                    <div className="flex justify-center pt-1.5 pb-1">
                                      <div className="w-20 h-4 bg-black rounded-full" />
                                    </div>
                                    <div className="px-3 pb-4 max-h-[400px] overflow-y-auto">
                                      <p className="text-[10px] text-zinc-400 uppercase tracking-wider font-semibold mb-2">Learn More</p>
                                      {infoByLocale[activeLocale].map((sec, i) => {
                                        const typeStyle: Record<string, string> = {
                                          grammar: "bg-blue-50 border-blue-200",
                                          common_mistakes: "bg-red-50 border-red-200",
                                          cultural: "bg-purple-50 border-purple-200",
                                          contextual_translation: "bg-amber-50 border-amber-200",
                                          extra_notes: "bg-zinc-50 border-zinc-200",
                                        };
                                        const typeLabelColor: Record<string, string> = {
                                          grammar: "text-blue-700",
                                          common_mistakes: "text-red-700",
                                          cultural: "text-purple-700",
                                          contextual_translation: "text-amber-700",
                                          extra_notes: "text-zinc-700",
                                        };
                                        return (
                                          <div key={i} className={`rounded-lg border ${typeStyle[sec.section_type] || typeStyle.extra_notes} p-3 mb-2.5`}>
                                            <div className="flex items-center gap-1.5 mb-1.5">
                                              <span className={`text-[10px] font-semibold ${typeLabelColor[sec.section_type] || typeLabelColor.extra_notes}`}>
                                                {sec.section_type.replace("_", " ")}
                                              </span>
                                              {sec.tp_name && <span className="text-[9px] text-zinc-400">{sec.tp_name}</span>}
                                            </div>
                                            <h4 className="font-semibold text-[12px] text-zinc-900 mb-1.5 leading-snug">{sec.title}</h4>
                                            <div className="pool-info-md text-[11px] leading-relaxed text-zinc-700">
                                              <ReactMarkdown>{sec.body}</ReactMarkdown>
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                    <div className="flex justify-center pb-1.5 pt-0.5">
                                      <div className="w-24 h-1 bg-zinc-200 rounded-full" />
                                    </div>
                                  </div>
                                </div>
                              ) : (
                                /* Raw view */
                                <div className="space-y-2">
                                  {infoByLocale[activeLocale].map((sec, i) => (
                                    <div key={i} className="bg-sky-50 rounded p-2 text-xs">
                                      <div className="flex items-center gap-2 mb-1">
                                        <span className="text-sky-600 font-medium">{sec.section_type}</span>
                                        {sec.tp_name && <span className="text-zinc-400">({sec.tp_name})</span>}
                                      </div>
                                      <p className="text-zinc-700 font-medium">{sec.title}</p>
                                      <pre className="text-zinc-600 mt-1 whitespace-pre-wrap max-h-40 overflow-y-auto font-mono text-[11px] bg-white/50 p-2 rounded">{sec.body}</pre>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Pipeline Logs */}
                  <div className="border-t border-zinc-100 pt-3">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-medium text-zinc-500">Pipeline Logs</p>
                      <button
                        onClick={() => fetchLogs(item.id)}
                        disabled={logsLoading === item.id}
                        className="text-[10px] text-zinc-400 hover:text-zinc-700 disabled:opacity-50"
                      >
                        {logsLoading === item.id ? "Loading..." : logs[item.id] ? "Refresh" : "Load logs"}
                      </button>
                    </div>
                    {logs[item.id] && logs[item.id].length > 0 ? (
                      <div className="bg-zinc-50 rounded p-2 max-h-64 overflow-y-auto space-y-1 font-mono text-[10px]">
                        {logs[item.id].map((log) => {
                          const colorClass =
                            log.level === "error" ? "text-red-600" :
                            log.level === "warn" ? "text-amber-600" :
                            "text-zinc-600";
                          return (
                            <div key={log.id} className={`${colorClass} leading-tight`}>
                              <span className="text-zinc-400">
                                {new Date(log.created_at).toLocaleTimeString()}
                              </span>
                              {" "}
                              <span className="font-semibold">[{log.phase}/{log.level}]</span>
                              {" "}
                              <span>{log.message}</span>
                              {log.metadata && (
                                <div className="text-zinc-400 pl-6">
                                  {JSON.stringify(log.metadata)}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : logs[item.id] ? (
                      <p className="text-[10px] text-zinc-400 italic">No logs yet</p>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {/* Markdown styles for info section preview */}
      <style>{`
        .pool-info-md p { margin-bottom: 0.35rem; }
        .pool-info-md strong { color: #18181b; font-weight: 600; }
        .pool-info-md code {
          background: rgba(0,0,0,0.06);
          padding: 1px 4px;
          border-radius: 3px;
          font-size: 0.9em;
          color: #7c3aed;
          font-family: ui-monospace, monospace;
        }
        .pool-info-md blockquote {
          border-left: 2px solid #a78bfa;
          padding-left: 8px;
          margin: 4px 0;
          color: #6b7280;
          font-style: italic;
        }
        .pool-info-md ul { padding-left: 1em; margin: 4px 0; }
        .pool-info-md li { margin-bottom: 1px; list-style-type: disc; }
        .pool-info-md li::marker { color: #a78bfa; }
        .pool-info-md em { color: #6b7280; }
      `}</style>
    </div>
  );
}
