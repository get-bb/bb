import type { NotesSettings } from "./vscode-settings.js";

/**
 * Markdown styling Monaco's grammar cannot express, written as ordinary
 * `highlight.regexes` rules so it runs through the same decoration path as
 * the imported VS Code ones.
 *
 * Two gaps motivate this. Monarch tags every heading level `keyword.md`, so
 * a theme alone cannot tell `#` from `######` — yet heading depth is the
 * main structural cue in a note. And a task list is just a list to the
 * grammar, so a finished item looks identical to an open one.
 *
 * These are kept separate from the user's `highlight.regexes` rather than
 * merged into them: replacing that setting in a `.vscode/settings.json`
 * should not silently strip heading colours.
 */

/** Heading ramp, H1 first. Warm-to-cool so depth reads at a glance. */
const HEADING_RAMP = {
  light: ["#8250df", "#0550ae", "#0a7ea4", "#116329", "#7d4e00", "#6e7781"],
  dark: ["#d2a8ff", "#79c0ff", "#56d4dd", "#7ee787", "#e3b341", "#8b949e"],
} as const;

const TASK_DONE = { light: "#116329", dark: "#3fb950" } as const;
const TASK_OPEN = { light: "#0550ae", dark: "#79c0ff" } as const;
const TASK_DONE_TEXT = { light: "#8c959f", dark: "#6e7681" } as const;

export type ThemeType = "light" | "dark";

export function builtinMarkdownSettings(
  themeType: ThemeType,
): NotesSettings {
  const ramp = HEADING_RAMP[themeType];
  const regexes: NonNullable<NotesSettings["highlight.regexes"]> = {};

  for (let level = 1; level <= 6; level += 1) {
    const hashes = "#".repeat(level);
    // `{0,3}` of leading space matches CommonMark's indent allowance; the
    // trailing `(?!#)` stops the H1 rule from also claiming an H2.
    regexes[`^[ ]{0,3}(${hashes}(?!#)[ \\t].*)$`] = {
      filterLanguageRegex: "markdown",
      regexFlags: "g",
      decorations: [
        {
          color: ramp[level - 1],
          fontWeight: level <= 3 ? "bold" : "normal",
        },
      ],
    };
  }

  // A completed task: tick in green, its text dimmed so open work stands out.
  regexes["^[ \\t]*(?:[-*+]|\\d+[.)])[ \\t](\\[[xX]\\])(.*)$"] = {
    filterLanguageRegex: "markdown",
    regexFlags: "g",
    decorations: [
      { color: TASK_DONE[themeType], fontWeight: "bold" },
      { color: TASK_DONE_TEXT[themeType] },
    ],
  };

  regexes["^[ \\t]*(?:[-*+]|\\d+[.)])[ \\t](\\[[ ]\\])"] = {
    filterLanguageRegex: "markdown",
    regexFlags: "g",
    decorations: [{ color: TASK_OPEN[themeType], fontWeight: "bold" }],
  };

  return { "highlight.regexes": regexes };
}
