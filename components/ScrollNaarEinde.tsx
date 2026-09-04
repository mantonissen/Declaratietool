"use client";

import { useEffect, useRef } from "react";

/**
 * Een horizontaal scrollende container die bij het laden aan het einde
 * staat. Voor een tijdreeks is rechts het heden; op een smal scherm is dat
 * wat je wilt zien, niet de lege maanden van een jaar geleden.
 */
export function ScrollNaarEinde({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, []);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
