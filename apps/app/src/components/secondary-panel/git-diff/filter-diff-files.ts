import picomatch from "picomatch/posix";
import type { DiffFileEntry } from "bb-plugin-bb--git/contract";

type DiffFilePathMatcher = (path: string) => boolean;

interface DiffFilePatternMatchers {
  exact: DiffFilePathMatcher;
  partial: DiffFilePathMatcher;
}

function compileGlob(patterns: string | string[], basename: boolean) {
  return picomatch(patterns, { basename, dot: true, nocase: true });
}

function compileDiffFilePattern(pattern: string): DiffFilePatternMatchers {
  if (!picomatch.scan(pattern).isGlob) {
    const needle = pattern.toLowerCase();
    const matcher = (path: string) => path.toLowerCase().includes(needle);
    return { exact: matcher, partial: matcher };
  }
  const hasSlash = pattern.includes("/");
  return {
    exact: compileGlob(pattern, !hasSlash),
    partial: hasSlash
      ? compileGlob([`${pattern}*`, `${pattern}*/**`], false)
      : compileGlob(`${pattern}*`, true),
  };
}

export function filterDiffFilesByPath<
  T extends Pick<DiffFileEntry, "path" | "previousPath">,
>(files: readonly T[], query: string): readonly T[] {
  const patterns = query
    .split(",")
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern !== "" && pattern !== "!");
  if (patterns.length === 0) {
    return files;
  }
  const fileMatches = (file: T, isMatch: DiffFilePathMatcher) =>
    [file.path, file.previousPath].some(
      (path) => path !== null && isMatch(path),
    );
  const included = patterns
    .filter((pattern) => !pattern.startsWith("!"))
    .map((pattern) => {
      const { exact, partial } = compileDiffFilePattern(pattern);
      return files.some((file) => fileMatches(file, exact)) ? exact : partial;
    });
  const candidates =
    included.length === 0
      ? files
      : files.filter((file) =>
          included.some((isMatch) => fileMatches(file, isMatch)),
        );
  const excluded = patterns
    .filter((pattern) => pattern.startsWith("!"))
    .map((pattern) => compileDiffFilePattern(pattern.slice(1)).exact)
    .filter(
      (isMatch) => !candidates.every((file) => fileMatches(file, isMatch)),
    );
  if (excluded.length === 0) {
    return candidates;
  }
  return candidates.filter(
    (file) => !excluded.some((isMatch) => fileMatches(file, isMatch)),
  );
}
