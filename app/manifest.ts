import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Declaratietool",
    short_name: "Uren",
    description: "Uren, bezoeken en kilometers bijhouden.",
    start_url: "/uren",
    display: "standalone",
    background_color: "#f2f4f0",
    theme_color: "#0b6b4f",
    lang: "nl",
    icons: [
      { src: "/icoon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
