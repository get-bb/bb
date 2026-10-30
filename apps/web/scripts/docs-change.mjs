import { execFileSync } from "node:child_process";

export const DOCS_PATHS = [
  /^apps\/web\/content\/docs\//u,
  /^apps\/web\/src\/docs\//u,
  /^apps\/web\/src\/routes\/docs[.]/u,
  /^apps\/web\/src\/routes\/llms(-full)?\[\.\]txt\.tsx$/u,
  /^apps\/web\/public\/docs-images\//u,
  /^\.bb\/skills\/docs-writing\//u,
  /^\.bb\/skills\/docs-images\//u,
];

export function touchesDocs(files) {
  return files.some((file) => DOCS_PATHS.some((pattern) => pattern.test(file)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const base = process.argv[2];
  if (!base) {
    console.error("Usage: docs-change.mjs <base-sha>");
    process.exit(2);
  }
  const files = execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], {
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
  console.log(touchesDocs(files) ? "true" : "false");
}
