import { z } from "zod";

/**
 * The subset of a VS Code `settings.json` that Notes understands.
 *
 * Unknown keys are kept rather than rejected: a real `settings.json` carries
 * dozens of settings for extensions Notes has nothing to do with, and
 * dropping the file because of one of them would be worse than ignoring it.
 */
export const decorationSchema = z
  .object({
    color: z.string().optional(),
    backgroundColor: z.string().optional(),
    fontWeight: z.string().optional(),
    fontStyle: z.string().optional(),
    textDecoration: z.string().optional(),
    overviewRulerColor: z.string().optional(),
    border: z.string().optional(),
    borderRadius: z.string().optional(),
  })
  .loose();

export type DecorationStyle = z.infer<typeof decorationSchema>;

export const highlightRuleSchema = z
  .object({
    filterFileRegex: z.string().optional(),
    filterLanguageRegex: z.string().optional(),
    regexFlags: z.string().optional(),
    decorations: z.array(decorationSchema).default([]),
  })
  .loose();

export type HighlightRuleConfig = z.infer<typeof highlightRuleSchema>;

export const notesSettingsSchema = z
  .object({
    "highlight.regexes": z.record(z.string(), highlightRuleSchema).optional(),
    "highlight.regexFlags": z.string().optional(),
    "markdown.extension.toc.orderedList": z.boolean().optional(),
    "editor.wordWrap": z.enum(["on", "off"]).optional(),
    "editor.fontSize": z.number().int().min(6).max(72).optional(),
    "editor.lineNumbers": z.enum(["on", "off", "relative"]).optional(),
  })
  .loose();

export type NotesSettings = z.infer<typeof notesSettingsSchema>;

/**
 * VS Code's Highlight extension defaults `regexFlags` to `"gi"`, so a rule
 * written as `#TODO` also lights up `#todo`. Notes keeps that behaviour so
 * an imported `settings.json` highlights the same text it did in VS Code.
 */
export const DEFAULT_REGEX_FLAGS = "gi";

/**
 * Imported verbatim from the user's VS Code preferences so the rules they
 * already rely on apply the first time the panel opens, with no setup step.
 * A `.vscode/settings.json` inside the notes root overrides this per key.
 */
export const IMPORTED_VSCODE_SETTINGS: NotesSettings = {
  "markdown.extension.toc.orderedList": true,
  "highlight.regexes": {
    "((?:<!-- *)?(?:#|// @|//|./\\*+|<!--|--|\\* @|{!|{{!--|{{!) *TODO(?:[\\t\\f\\v ]*\\([^\\r\\n)]+\\))?:?)((?!\\w)(?: *-->| *\\*/| *!}| *--}}| *}}|(?= *(?:[^\\r\\n:]//|/\\*+|<!--|@|--|{!|{{!--|{{!))|(?: +[^\\r\\n@]*?)(?= *(?:[^\\r\\n:]//|/\\*+|<!--|@|--(?!>)|{!|{{!--|{{!))|(?: +[^\\r\\n@]+)?))":
      {
        filterFileRegex: ".*(?<!CHANGELOG.md)$",
        decorations: [
          {
            overviewRulerColor: "#ffcc00",
            backgroundColor: "#ffcc00",
            color: "#1f1f1f",
            fontWeight: "bold",
          },
          {
            backgroundColor: "#ffcc00",
            color: "#1f1f1f",
          },
        ],
      },
    "((?:<!-- *)?(?:#|// @|//|./\\*+|<!--|--|\\* @|{!|{{!--|{{!) *(?:FIXME|FIX|BUG|UGLY|DEBUG|HACK)(?:[\\t\\f\\v ]*\\([^\\r\\n)]+\\))?:?)((?!\\w)(?: *-->| *\\*/| *!}| *--}}| *}}|(?= *(?:[^\\r\\n:]//|/\\*+|<!--|@|--|{!|{{!--|{{!))|(?: +[^\\r\\n@]*?)(?= *(?:[^\\r\\n:]//|/\\*+|<!--|@|--(?!>)|{!|{{!--|{{!))|(?: +[^\\r\\n@]+)?))":
      {
        filterFileRegex: ".*(?<!CHANGELOG.md)$",
        decorations: [
          {
            overviewRulerColor: "#cc0000",
            backgroundColor: "#cc0000",
            color: "#1f1f1f",
            fontWeight: "bold",
          },
          {
            backgroundColor: "#cc0000",
            color: "#1f1f1f",
          },
        ],
      },
    "(#PRIORITY\\b)": {
      filterLanguageRegex: "markdown",
      decorations: [
        {
          color: "#FF5555",
          fontWeight: "bold",
        },
      ],
    },
    "(#DONE\\b)(.*)": {
      filterLanguageRegex: "markdown",
      decorations: [
        {
          color: "#50FA7B",
          fontWeight: "bold",
        },
        {
          color: "rgba(255, 255, 255, 0.25)",
          textDecoration: "none",
        },
      ],
    },
    "(#LATER\\b)(.*)": {
      filterLanguageRegex: "markdown",
      decorations: [
        {
          color: "#fcb103",
          fontWeight: "bold",
        },
      ],
    },
    "(@(.*))": {
      filterLanguageRegex: "markdown",
      decorations: [
        {
          color: "theme.textLink.activeForeground",
        },
      ],
    },
  },
};

/**
 * Strips `//` and `/* *\/` comments and trailing commas so a real VS Code
 * settings file — which is JSONC, not JSON — parses. Returns null rather
 * than throwing: a malformed override should fall back to the imported
 * defaults, not blank the panel.
 */
export function parseJsonc(source: string): unknown {
  const withoutComments = source.replace(
    /"(?:\\.|[^"\\])*"|\/\*[\s\S]*?\*\/|\/\/[^\n\r]*/g,
    (match) => (match.startsWith('"') ? match : " "),
  );
  const withoutTrailingCommas = withoutComments.replace(
    /,(\s*[}\]])/g,
    (_match, tail: string) => tail,
  );
  try {
    return JSON.parse(withoutTrailingCommas);
  } catch {
    return null;
  }
}

/**
 * Later sources win per key. `highlight.regexes` replaces wholesale rather
 * than merging rule-by-rule, matching how VS Code treats an object setting:
 * a user who redefines it means the set they wrote, not that set plus ours.
 */
export function mergeSettings(
  ...sources: readonly (NotesSettings | null)[]
): NotesSettings {
  const merged: Record<string, unknown> = {};
  for (const source of sources) {
    if (source === null) continue;
    for (const [key, value] of Object.entries(source)) {
      if (value === undefined) continue;
      merged[key] = value;
    }
  }
  return merged as NotesSettings;
}

export function parseSettings(source: string): NotesSettings | null {
  const raw = parseJsonc(source);
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const parsed = notesSettingsSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
