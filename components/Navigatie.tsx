"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Icoon = "uren" | "ritten" | "week" | "beheer";

type Item = { href: string; label: string; icoon: Icoon };

const PADEN: Record<Icoon, string> = {
  // Klok
  uren: "M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z",
  // Weg met streep
  ritten: "M5 21 8 3M19 21 16 3M12 5v3M12 11v3M12 17v3",
  // Kalender
  week: "M4 8h16M4 5h16v15H4zM8 3v4M16 3v4",
  // Schuifregelaars
  beheer: "M5 6h14M5 12h14M5 18h14M9 4v4M15 10v4M9 16v4",
};

function Teken({ icoon }: { icoon: Icoon }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="size-5 shrink-0"
    >
      <path d={PADEN[icoon]} />
    </svg>
  );
}

export function Navigatie({
  items,
  variant,
}: {
  items: Item[];
  variant: "zijbalk" | "onderbalk";
}) {
  const pad = usePathname();
  const actief = (href: string) => pad === href || pad.startsWith(href + "/");

  if (variant === "zijbalk") {
    return (
      <nav className="flex flex-col gap-0.5 p-2">
        {items.map((i) => (
          <Link
            key={i.href}
            href={i.href}
            aria-current={actief(i.href) ? "page" : undefined}
            className={`flex items-center gap-3 rounded px-3 py-2 text-sm font-medium ${
              actief(i.href)
                ? "bg-accent-bg text-accent-ink"
                : "text-ink-2 hover:bg-surface-2"
            }`}
          >
            <Teken icoon={i.icoon} />
            {i.label}
          </Link>
        ))}
      </nav>
    );
  }

  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
      <ul className="grid" style={{ gridTemplateColumns: `repeat(${items.length}, 1fr)` }}>
        {items.map((i) => (
          <li key={i.href}>
            <Link
              href={i.href}
              aria-current={actief(i.href) ? "page" : undefined}
              className={`flex min-h-14 flex-col items-center justify-center gap-1 text-[0.6875rem] font-medium ${
                actief(i.href) ? "text-accent-ink" : "text-muted"
              }`}
            >
              <Teken icoon={i.icoon} />
              {i.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
