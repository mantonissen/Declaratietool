import { redirect } from "next/navigation";
import Link from "next/link";
import { huidigeSessie, magBeheren } from "@/lib/auth";
import { Navigatie } from "@/components/Navigatie";

export default async function WerkLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const sessie = await huidigeSessie();
  if (!sessie) redirect("/login");

  const items = [
    { href: "/uren", label: "Uren", icoon: "uren" as const },
    { href: "/ritten", label: "Ritten", icoon: "ritten" as const },
    { href: "/week", label: "Week", icoon: "week" as const },
    { href: "/inzicht", label: "Inzicht", icoon: "inzicht" as const },
    ...(sessie.rechten === "eigenaar"
      ? [{ href: "/boekhouding", label: "Boekhouding", icoon: "boekhouding" as const }]
      : []),
    ...(magBeheren(sessie.rechten)
      ? [{ href: "/beheer", label: "Beheer", icoon: "beheer" as const }]
      : []),
  ];

  return (
    <div className="min-h-dvh md:flex">
      {/* Desktop: vaste zijbalk. Mobiel: verborgen, zie de balk onderaan. */}
      <aside className="hidden md:flex md:w-56 md:shrink-0 md:flex-col md:border-r md:border-line md:bg-surface">
        <div className="border-b border-line px-5 py-4">
          <p className="label">Declaratietool</p>
          <p className="mt-1 truncate text-sm font-semibold">{sessie.naam}</p>
          <p className="text-xs text-muted capitalize">{sessie.rechten}</p>
        </div>
        <Navigatie items={items} variant="zijbalk" />
        <div className="mt-auto border-t border-line p-3">
          <Link
            href="/login/uit"
            prefetch={false}
            className="block px-2 py-1 text-xs text-muted hover:text-ink"
          >
            Uitloggen
          </Link>
        </div>
      </aside>

      <main className="min-w-0 flex-1 pb-20 md:pb-0">{children}</main>

      {/* Mobiel: balk onderaan, binnen duimbereik. */}
      <Navigatie items={items} variant="onderbalk" />
    </div>
  );
}
