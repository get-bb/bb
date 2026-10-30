import { execFileSync } from "node:child_process";

export const DOCS_ONLY_PATHS = [
  /^apps\/web\/content\/docs\//u,
  /^apps\/web\/src\/docs\//u,
  /^apps\/web\/src\/routes\/docs[.]/u,
  /^apps\/web\/src\/routes\/llms(-full)?\[\.\]txt\.tsx$/u,
  /^\.bb\/skills\/docs-writing\//u,
];

export function isDocsOnlyChange(files) {
  return (
    files.length > 0 &&
    files.every((file) => DOCS_ONLY_PATHS.some((pattern) => pattern.test(file)))
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const base = process.argv[2];
  if (!base) {
    console.error("Usage: docs-only-change.mjs <base-sha>");
    process.exit(2);
  }
  const files = execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], {
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
  console.log(isDocsOnlyChange(files) ? "true" : "false");
}
