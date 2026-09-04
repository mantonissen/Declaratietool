import type { NextConfig } from "next";

const config: NextConfig = {
  // pdfkit leest zijn lettertypen van schijf; gebundeld raakt het die kwijt.
  serverExternalPackages: ["pdfkit"],
};

export default config;
