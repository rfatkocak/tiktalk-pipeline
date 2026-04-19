"use client";

import { useMemo, useState } from "react";

export type TP = {
  id: string;
  category: string;
  subcategory: string | null;
  name: string;
  level: "beginner" | "intermediate" | "advanced";
  description: string | null;
  usage_count: number;
  created_at: string;
};

const LEVELS = ["beginner", "intermediate", "advanced"] as const;
type Level = (typeof LEVELS)[number];

const LEVEL_COLORS: Record<Level, string> = {
  beginner: "bg-emerald-50 text-emerald-700 border-emerald-200",
  intermediate: "bg-amber-50 text-amber-700 border-amber-200",
  advanced: "bg-rose-50 text-rose-700 border-rose-200",
};

type UsageFilter = "all" | "unused" | "in_use" | "maxed";
type SortOption = "default" | "name_asc" | "name_desc" | "usage_asc" | "usage_desc" | "newest" | "oldest";
type GroupOption = "category" | "subcategory" | "level" | "none";

export function TPExplorer({ tps }: { tps: TP[] }) {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [levelFilter, setLevelFilter] = useState<Level | null>(null);
  const [subcategoryFilter, setSubcategoryFilter] = useState<string | null>(null);
  const [usageFilter, setUsageFilter] = useState<UsageFilter>("all");
  const [sort, setSort] = useState<SortOption>("default");
  const [groupBy, setGroupBy] = useState<GroupOption>("category");
  const [expandedDescriptions, setExpandedDescriptions] = useState(false);

  // ── Stats ─────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const total = tps.length;
    const byLevel: Record<Level, number> = { beginner: 0, intermediate: 0, advanced: 0 };
    const byCategory: Record<string, number> = {};
    const matrix: Record<string, Record<Level, number>> = {};

    for (const tp of tps) {
      byLevel[tp.level]++;
      byCategory[tp.category] = (byCategory[tp.category] || 0) + 1;
      if (!matrix[tp.category]) matrix[tp.category] = { beginner: 0, intermediate: 0, advanced: 0 };
      matrix[tp.category][tp.level]++;
    }

    const totalUsage = tps.reduce((s, tp) => s + tp.usage_count, 0);
    const usedCount = tps.filter((tp) => tp.usage_count > 0).length;
    const maxedCount = tps.filter((tp) => tp.usage_count >= 5).length;

    return { total, byLevel, byCategory, matrix, totalUsage, usedCount, maxedCount };
  }, [tps]);

  const allCategories = Object.keys(stats.byCategory).sort();
  const subcategoriesForCategory = useMemo(() => {
    if (!categoryFilter) return [];
    const set = new Set<string>();
    for (const tp of tps) {
      if (tp.category === categoryFilter && tp.subcategory) set.add(tp.subcategory);
    }
    return Array.from(set).sort();
  }, [tps, categoryFilter]);

  // ── Filtering ─────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tps.filter((tp) => {
      if (categoryFilter && tp.category !== categoryFilter) return false;
      if (levelFilter && tp.level !== levelFilter) return false;
      if (subcategoryFilter && tp.subcategory !== subcategoryFilter) return false;
      if (usageFilter === "unused" && tp.usage_count !== 0) return false;
      if (usageFilter === "in_use" && (tp.usage_count === 0 || tp.usage_count >= 5)) return false;
      if (usageFilter === "maxed" && tp.usage_count < 5) return false;
      if (q) {
        const hay = `${tp.name} ${tp.subcategory || ""} ${tp.description || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [tps, search, categoryFilter, levelFilter, subcategoryFilter, usageFilter]);

  // ── Sorting ───────────────────────────────────────────────────
  const sorted = useMemo(() => {
    const arr = [...filtered];
    switch (sort) {
      case "name_asc":
        arr.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case "name_desc":
        arr.sort((a, b) => b.name.localeCompare(a.name));
        break;
      case "usage_asc":
        arr.sort((a, b) => a.usage_count - b.usage_count || a.name.localeCompare(b.name));
        break;
      case "usage_desc":
        arr.sort((a, b) => b.usage_count - a.usage_count || a.name.localeCompare(b.name));
        break;
      case "newest":
        arr.sort((a, b) => b.created_at.localeCompare(a.created_at));
        break;
      case "oldest":
        arr.sort((a, b) => a.created_at.localeCompare(b.created_at));
        break;
      // "default" = original ORDER BY from SQL
    }
    return arr;
  }, [filtered, sort]);

  // ── Grouping ──────────────────────────────────────────────────
  const groups = useMemo(() => {
    if (groupBy === "none") return [{ key: "All", items: sorted }];
    const map = new Map<string, TP[]>();
    for (const tp of sorted) {
      let key: string;
      if (groupBy === "category") key = tp.category;
      else if (groupBy === "subcategory") key = `${tp.category} / ${tp.subcategory || "(none)"}`;
      else key = tp.level;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(tp);
    }
    return Array.from(map.entries()).map(([key, items]) => ({ key, items }));
  }, [sorted, groupBy]);

  const hasActiveFilters =
    !!search ||
    !!categoryFilter ||
    !!levelFilter ||
    !!subcategoryFilter ||
    usageFilter !== "all" ||
    sort !== "default" ||
    groupBy !== "category";

  const resetAll = () => {
    setSearch("");
    setCategoryFilter(null);
    setLevelFilter(null);
    setSubcategoryFilter(null);
    setUsageFilter("all");
    setSort("default");
    setGroupBy("category");
  };

  return (
    <>
      {/* ── Top stats ───────────────────────────────────────────── */}
      <div className="grid grid-cols-5 gap-4 mb-6">
        <StatCard label="Total TPs" value={stats.total} />
        <StatCard label="Beginner" value={stats.byLevel.beginner} accent="emerald" />
        <StatCard label="Intermediate" value={stats.byLevel.intermediate} accent="amber" />
        <StatCard label="Advanced" value={stats.byLevel.advanced} accent="rose" />
        <StatCard
          label="Coverage"
          value={`${stats.usedCount} / ${stats.total}`}
          sublabel={`${stats.maxedCount} maxed · ${stats.totalUsage} uses`}
        />
      </div>

      {/* ── Matrix ─────────────────────────────────────────────── */}
      <details className="bg-white border border-zinc-200 rounded-lg mb-6 group">
        <summary className="px-5 py-3 cursor-pointer text-sm font-semibold text-zinc-700 list-none flex items-center justify-between">
          <span>Category × Level matrix</span>
          <span className="text-xs text-zinc-400 group-open:rotate-90 transition-transform">▶</span>
        </summary>
        <table className="w-full text-sm border-t border-zinc-200">
          <thead className="bg-zinc-50 text-zinc-500">
            <tr>
              <th className="text-left px-5 py-2 font-medium">Category</th>
              <th className="text-right px-5 py-2 font-medium">Beginner</th>
              <th className="text-right px-5 py-2 font-medium">Intermediate</th>
              <th className="text-right px-5 py-2 font-medium">Advanced</th>
              <th className="text-right px-5 py-2 font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {allCategories.map((cat) => {
              const row = stats.matrix[cat];
              const rowTotal = row.beginner + row.intermediate + row.advanced;
              return (
                <tr key={cat} className="border-t border-zinc-100">
                  <td className="px-5 py-2 font-medium text-zinc-800 capitalize">{cat}</td>
                  <td className="px-5 py-2 text-right text-zinc-600 tabular-nums">{row.beginner || "—"}</td>
                  <td className="px-5 py-2 text-right text-zinc-600 tabular-nums">{row.intermediate || "—"}</td>
                  <td className="px-5 py-2 text-right text-zinc-600 tabular-nums">{row.advanced || "—"}</td>
                  <td className="px-5 py-2 text-right font-semibold text-zinc-900 tabular-nums">{rowTotal}</td>
                </tr>
              );
            })}
            <tr className="border-t-2 border-zinc-300 bg-zinc-50">
              <td className="px-5 py-2 font-semibold text-zinc-800">Total</td>
              <td className="px-5 py-2 text-right font-semibold tabular-nums">{stats.byLevel.beginner}</td>
              <td className="px-5 py-2 text-right font-semibold tabular-nums">{stats.byLevel.intermediate}</td>
              <td className="px-5 py-2 text-right font-semibold tabular-nums">{stats.byLevel.advanced}</td>
              <td className="px-5 py-2 text-right font-bold tabular-nums">{stats.total}</td>
            </tr>
          </tbody>
        </table>
      </details>

      {/* ── Filter bar ─────────────────────────────────────────── */}
      <div className="bg-white border border-zinc-200 rounded-lg p-4 mb-4 space-y-3">
        {/* Row 1: search + reset */}
        <div className="flex gap-2 items-center">
          <input
            type="text"
            placeholder="Search by name, subcategory, or description..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 px-3 py-2 text-sm border border-zinc-200 rounded-md focus:outline-none focus:border-zinc-400"
          />
          {hasActiveFilters && (
            <button
              onClick={resetAll}
              className="px-3 py-2 text-sm text-zinc-500 hover:text-zinc-900 border border-zinc-200 rounded-md hover:bg-zinc-50"
            >
              Reset
            </button>
          )}
        </div>

        {/* Row 2: category chips */}
        <div className="flex gap-1.5 flex-wrap items-center">
          <span className="text-xs text-zinc-400 mr-1 w-16">Category</span>
          <Chip active={!categoryFilter} onClick={() => { setCategoryFilter(null); setSubcategoryFilter(null); }}>
            All <span className="opacity-50">({stats.total})</span>
          </Chip>
          {allCategories.map((cat) => (
            <Chip
              key={cat}
              active={categoryFilter === cat}
              onClick={() => {
                setCategoryFilter(categoryFilter === cat ? null : cat);
                setSubcategoryFilter(null);
              }}
            >
              <span className="capitalize">{cat}</span>{" "}
              <span className="opacity-50">({stats.byCategory[cat]})</span>
            </Chip>
          ))}
        </div>

        {/* Row 3: subcategory chips (only when a category is selected) */}
        {categoryFilter && subcategoriesForCategory.length > 0 && (
          <div className="flex gap-1.5 flex-wrap items-center">
            <span className="text-xs text-zinc-400 mr-1 w-16">Subcat</span>
            <Chip active={!subcategoryFilter} onClick={() => setSubcategoryFilter(null)}>
              All
            </Chip>
            {subcategoriesForCategory.map((sub) => (
              <Chip
                key={sub}
                active={subcategoryFilter === sub}
                onClick={() => setSubcategoryFilter(subcategoryFilter === sub ? null : sub)}
              >
                {sub}
              </Chip>
            ))}
          </div>
        )}

        {/* Row 4: level + usage chips */}
        <div className="flex gap-1.5 flex-wrap items-center">
          <span className="text-xs text-zinc-400 mr-1 w-16">Level</span>
          <Chip active={!levelFilter} onClick={() => setLevelFilter(null)}>All</Chip>
          {LEVELS.map((lv) => (
            <Chip
              key={lv}
              active={levelFilter === lv}
              onClick={() => setLevelFilter(levelFilter === lv ? null : lv)}
              tone={lv}
            >
              {lv} <span className="opacity-50">({stats.byLevel[lv]})</span>
            </Chip>
          ))}
        </div>

        <div className="flex gap-1.5 flex-wrap items-center">
          <span className="text-xs text-zinc-400 mr-1 w-16">Usage</span>
          <Chip active={usageFilter === "all"} onClick={() => setUsageFilter("all")}>All</Chip>
          <Chip active={usageFilter === "unused"} onClick={() => setUsageFilter("unused")}>
            Unused <span className="opacity-50">({stats.total - stats.usedCount})</span>
          </Chip>
          <Chip active={usageFilter === "in_use"} onClick={() => setUsageFilter("in_use")}>
            In use <span className="opacity-50">({stats.usedCount - stats.maxedCount})</span>
          </Chip>
          <Chip active={usageFilter === "maxed"} onClick={() => setUsageFilter("maxed")}>
            Maxed (5+) <span className="opacity-50">({stats.maxedCount})</span>
          </Chip>
        </div>

        {/* Row 5: sort + group + descriptions */}
        <div className="flex gap-3 items-center pt-1 border-t border-zinc-100">
          <label className="text-xs text-zinc-400 flex items-center gap-2">
            Sort
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortOption)}
              className="px-2 py-1 text-xs border border-zinc-200 rounded-md text-zinc-700"
            >
              <option value="default">Default</option>
              <option value="name_asc">Name A→Z</option>
              <option value="name_desc">Name Z→A</option>
              <option value="usage_asc">Usage low→high</option>
              <option value="usage_desc">Usage high→low</option>
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
            </select>
          </label>

          <label className="text-xs text-zinc-400 flex items-center gap-2">
            Group
            <select
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value as GroupOption)}
              className="px-2 py-1 text-xs border border-zinc-200 rounded-md text-zinc-700"
            >
              <option value="category">Category</option>
              <option value="subcategory">Subcategory</option>
              <option value="level">Level</option>
              <option value="none">No grouping</option>
            </select>
          </label>

          <label className="text-xs text-zinc-400 flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={expandedDescriptions}
              onChange={(e) => setExpandedDescriptions(e.target.checked)}
              className="accent-zinc-700"
            />
            Show descriptions
          </label>

          <span className="ml-auto text-xs text-zinc-500 tabular-nums">
            {sorted.length} of {stats.total} shown
          </span>
        </div>
      </div>

      {/* ── Result list ────────────────────────────────────────── */}
      {sorted.length === 0 ? (
        <div className="bg-white border border-zinc-200 rounded-lg p-8 text-center text-sm text-zinc-400">
          No teaching points match your filters.
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <div key={g.key} className="bg-white border border-zinc-200 rounded-lg overflow-hidden">
              <div className="px-5 py-2.5 border-b border-zinc-200 bg-zinc-50 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-zinc-700 capitalize">{g.key}</h3>
                <span className="text-xs text-zinc-400 tabular-nums">{g.items.length}</span>
              </div>
              <ul className="divide-y divide-zinc-100">
                {g.items.map((tp) => (
                  <li key={tp.id} className="px-5 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-xs font-medium border ${LEVEL_COLORS[tp.level]}`}
                          >
                            {tp.level}
                          </span>
                          <span className="text-sm font-medium text-zinc-900">{tp.name}</span>
                          {tp.subcategory && groupBy !== "subcategory" && (
                            <span className="text-xs text-zinc-400">· {tp.subcategory}</span>
                          )}
                          {groupBy !== "category" && (
                            <span className="text-xs text-zinc-400 capitalize">· {tp.category}</span>
                          )}
                        </div>
                        {expandedDescriptions && tp.description && (
                          <p className="text-xs text-zinc-500 leading-relaxed mt-2">{tp.description}</p>
                        )}
                      </div>
                      <div
                        className={`text-xs font-mono tabular-nums px-2 py-0.5 rounded shrink-0 ${
                          tp.usage_count >= 5
                            ? "bg-zinc-200 text-zinc-600"
                            : tp.usage_count > 0
                            ? "bg-blue-50 text-blue-700"
                            : "bg-zinc-50 text-zinc-400"
                        }`}
                      >
                        {tp.usage_count} / 5
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ── Sub-components ────────────────────────────────────────────
function StatCard({
  label,
  value,
  sublabel,
  accent,
}: {
  label: string;
  value: string | number;
  sublabel?: string;
  accent?: "emerald" | "amber" | "rose";
}) {
  const accentClass =
    accent === "emerald"
      ? "text-emerald-700"
      : accent === "amber"
      ? "text-amber-700"
      : accent === "rose"
      ? "text-rose-700"
      : "text-zinc-900";
  return (
    <div className="bg-white border border-zinc-200 rounded-lg p-5">
      <p className="text-sm text-zinc-400">{label}</p>
      <p className={`text-2xl font-semibold mt-1 ${accentClass}`}>{value}</p>
      {sublabel && <p className="text-xs text-zinc-400 mt-1">{sublabel}</p>}
    </div>
  );
}

function Chip({
  children,
  active,
  onClick,
  tone,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  tone?: Level;
}) {
  let activeClass = "bg-zinc-900 text-white border-zinc-900";
  if (active && tone === "beginner") activeClass = "bg-emerald-600 text-white border-emerald-600";
  if (active && tone === "intermediate") activeClass = "bg-amber-600 text-white border-amber-600";
  if (active && tone === "advanced") activeClass = "bg-rose-600 text-white border-rose-600";

  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
        active ? activeClass : "bg-white text-zinc-600 border-zinc-200 hover:border-zinc-400 hover:text-zinc-900"
      }`}
    >
      {children}
    </button>
  );
}
