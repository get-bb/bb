import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import matter from "gray-matter";

const CONTENT_DIR = "apps/web/content/docs";

function git(repo, args) {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
  }).trim();
}

function mdxFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return mdxFiles(entryPath);
    return entry.name.endsWith(".mdx") ? [entryPath] : [];
  });
}

function isoDate(value) {
  return value instanceof Date
    ? value.toISOString().slice(0, 10)
    : String(value);
}

function pathspec(glob) {
  return `:(glob)${glob}`;
}

function checkDocsFreshness(repo) {
  const results = [];
  for (const file of mdxFiles(path.join(repo, CONTENT_DIR)).toSorted()) {
    const relativeFile = path.relative(repo, file).split(path.sep).join("/");
    const { data } = matter(readFileSync(file, "utf8"));
    const sources = Array.isArray(data.sources) ? data.sources : [];
    const verified = isoDate(data.verified);
    const unmatched = sources.filter(
      (glob) => git(repo, ["ls-files", "--", pathspec(glob)]) === "",
    );
    const changed =
      sources.length === 0
        ? ""
        : git(repo, [
            "log",
            "-1",
            "--format=%cs",
            "--",
            ...sources.map(pathspec),
          ]);
    results.push({
      file: relativeFile,
      title: String(data.title),
      owner: String(data.owner),
      verified,
      changed: changed === "" ? null : changed,
      stale: changed !== "" && changed > verified,
      unmatched,
    });
  }
  return results;
}

function annotation(level, file, title, message) {
  return `::${level} file=${file},title=${title}::${message}`;
}

function report(results) {
  const lines = [];
  for (const page of results) {
    for (const glob of page.unmatched) {
      lines.push(
        annotation(
          "error",
          page.file,
          "Docs source matches no file",
          `"${page.title}" lists sources glob ${glob}, which matches no tracked file. Fix the glob, or remove the page with its feature. Owner: ${page.owner}.`,
        ),
      );
    }
    if (page.stale) {
      lines.push(
        annotation(
          "warning",
          page.file,
          "Docs page may be out of date",
          `"${page.title}" was verified on ${page.verified}, but its sources changed on ${page.changed}. Owner: ${page.owner}. Check the page against the app, fix it, and update verified.`,
        ),
      );
    }
  }
  return lines;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const repo =
    process.argv[2] ?? git(process.cwd(), ["rev-parse", "--show-toplevel"]);
  const results = checkDocsFreshness(repo);
  const lines = report(results);
  for (const line of lines) console.log(line);
  const stale = results.filter((page) => page.stale);
  console.log(
    `${results.length} docs pages checked, ${stale.length} out of date.`,
  );
  if (results.some((page) => page.unmatched.length > 0)) process.exitCode = 1;
}
