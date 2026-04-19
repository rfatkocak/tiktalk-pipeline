"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const nav = [
  { href: "/", label: "Dashboard" },
  { href: "/channels", label: "Channels" },
  { href: "/vibes", label: "Vibes" },
  { href: "/teaching-points", label: "Teaching Points" },
  { href: "/pool", label: "Pool" },
  { href: "/prompts", label: "Prompts" },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-56 border-r border-zinc-200 bg-white flex flex-col">
      <div className="p-5 border-b border-zinc-200">
        <h1 className="text-lg font-semibold tracking-tight">TikTalk</h1>
        <p className="text-xs text-zinc-400 mt-0.5">Admin Panel</p>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {nav.map((item) => {
          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`block px-3 py-2 rounded-md text-sm transition-colors ${
                active
                  ? "bg-zinc-100 text-zinc-900 font-medium"
                  : "text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
