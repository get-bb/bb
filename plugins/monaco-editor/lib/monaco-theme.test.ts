import { describe, expect, it } from "vitest";
import type { PluginCodeThemeData } from "@get-bb/plugin-sdk/app";
import {
  applyCodeTheme,
  editorBackground,
  monacoThemeName,
  toMonacoTheme,
} from "./monaco-theme.js";

function theme(
  overrides: Partial<PluginCodeThemeData> = {},
): PluginCodeThemeData {
  return {
    name: "bb:nord:light:1f4c9a2b",
    type: "light",
    fg: "#2e3440",
    bg: "#eceff4",
    colors: {},
    tokenColors: [],
    ...overrides,
  };
}

const MONACO_THEME_NAME = /^[a-zA-Z0-9-]+$/;

describe("monacoThemeName", () => {
  it("maps BB's namespaced, fingerprinted names into what Monaco accepts", () => {
    expect(monacoThemeName("bb:nord:light:1f4c9a2b")).toMatch(
      MONACO_THEME_NAME,
    );
    expect(monacoThemeName("catppuccin-mocha")).toMatch(MONACO_THEME_NAME);
  });

  it("keeps distinct theme names distinct", () => {
    expect(monacoThemeName("bb:nord:light")).not.toBe(
      monacoThemeName("bb:nord:dark"),
    );
  });
});

describe("toMonacoTheme", () => {
  it("takes its base from the theme's own type", () => {
    expect(toMonacoTheme(theme({ type: "dark" })).base).toBe("vs-dark");
    expect(toMonacoTheme(theme({ type: "light" })).base).toBe("vs");
  });

  it("emits a default rule so unmatched tokens do not fall back to the base theme", () => {
    expect(toMonacoTheme(theme()).rules[0]).toEqual({
      token: "",
      foreground: "2e3440",
    });
  });

  it("expands short hex and drops colors Monaco's rule parser would throw on", () => {
    const { rules } = toMonacoTheme(
      theme({
        tokenColors: [
          { scope: "comment", settings: { foreground: "#abc" } },
          { scope: "keyword", settings: { foreground: "not-a-color" } },
          { scope: "string", settings: { foreground: "#112233" } },
        ],
      }),
    );
    expect(rules).toContainEqual({ token: "comment", foreground: "aabbcc" });
    expect(rules).toContainEqual({ token: "string", foreground: "112233" });
    expect(rules.some((rule) => rule.token === "keyword")).toBe(false);
  });

  it.each([
    { color: "#BEB89999", bg: "#181818", expected: "7c7865" },
    { color: "#00000080", bg: "#ffffff", expected: "7f7f7f" },
    { color: "#fff0", bg: "#123", expected: "112233" },
    { color: "#abcF", bg: "#181818", expected: "aabbcc" },
  ])(
    "flattens $color onto the editor's $bg surface for Monaco",
    ({ color, bg, expected }) => {
      const { rules, colors } = toMonacoTheme(
        theme({
          bg: "#ff0000",
          colors: {
            "editor.background": bg,
            "editor.selectionBackground": "#88c0d033",
          },
          tokenColors: [{ scope: "comment", settings: { foreground: color } }],
        }),
      );
      expect(rules).toContainEqual({ token: "comment", foreground: expected });
      expect(colors["editor.selectionBackground"]).toBe("#88c0d033");
    },
  );

  it("splits both spellings of a multi-scope rule into one rule each", () => {
    const { rules } = toMonacoTheme(
      theme({
        tokenColors: [
          {
            scope: ["variable", "entity.name"],
            settings: { foreground: "#111111" },
          },
          {
            scope: "constant, support.type",
            settings: { foreground: "#222222" },
          },
        ],
      }),
    );
    expect(rules).toContainEqual({ token: "variable", foreground: "111111" });
    expect(rules).toContainEqual({
      token: "entity.name",
      foreground: "111111",
    });
    expect(rules).toContainEqual({ token: "constant", foreground: "222222" });
    expect(rules).toContainEqual({
      token: "support.type",
      foreground: "222222",
    });
  });

  it("uses TextMate YAML keys and literal colors for Monarch without recoloring other languages", () => {
    const { rules } = toMonacoTheme(
      theme({
        tokenColors: [
          { scope: "keyword", settings: { foreground: "#fe5d86" } },
          {
            scope: ["constant.numeric", "constant.language"],
            settings: { foreground: "#a895fe" },
          },
          {
            scope: "entity.name.tag.yaml",
            settings: { foreground: "#9ddd54", fontStyle: "bold" },
          },
        ],
      }),
    );
    expect(rules).toContainEqual({
      token: "type.yaml",
      foreground: "9ddd54",
      fontStyle: "bold",
    });
    expect(rules).toContainEqual({
      token: "keyword.yaml",
      foreground: "a895fe",
    });
    expect(rules).toContainEqual({ token: "keyword", foreground: "fe5d86" });
    expect(rules.some((rule) => rule.token === "type")).toBe(false);
  });

  it("lets explicit Monarch rules override the TextMate aliases regardless of source order", () => {
    const { rules } = toMonacoTheme(
      theme({
        tokenColors: [
          { scope: "keyword.yaml", settings: { foreground: "#123456" } },
          { scope: "constant.language", settings: { foreground: "#a895fe" } },
        ],
      }),
    );
    expect(
      rules.filter((rule) => rule.token === "keyword.yaml").at(-1)?.foreground,
    ).toBe("123456");
  });

  it("keeps only the font styles Monaco understands", () => {
    const { rules } = toMonacoTheme(
      theme({
        tokenColors: [
          {
            scope: "comment",
            settings: {
              foreground: "#111111",
              fontStyle: "italic strikethrough",
            },
          },
          { scope: "keyword", settings: { fontStyle: "bold underline" } },
        ],
      }),
    );
    expect(rules).toContainEqual({
      token: "comment",
      foreground: "111111",
      fontStyle: "italic",
    });
    expect(rules).toContainEqual({
      token: "keyword",
      fontStyle: "bold underline",
    });
  });

  it("fills the editor surface from the theme's own pair when it declares no workbench colors", () => {
    expect(toMonacoTheme(theme()).colors).toEqual({
      "editor.background": "#eceff4",
      "editor.foreground": "#2e3440",
    });
  });

  it("prefers declared workbench colors and drops values Color.fromHex would read as red", () => {
    expect(
      toMonacoTheme(
        theme({
          colors: {
            "editor.background": "#1e1e1e",
            "editorCursor.foreground": "#88c0d0",
            "editor.selectionBackground": "rgba(0,0,0,0.2)",
          },
        }),
      ).colors,
    ).toEqual({
      "editor.background": "#1e1e1e",
      "editorCursor.foreground": "#88c0d0",
      "editor.foreground": "#2e3440",
    });
  });
});

describe("applyCodeTheme", () => {
  function fakeMonaco(defined: string[]) {
    return {
      editor: { defineTheme: (name: string) => defined.push(name) },
    } as unknown as Parameters<typeof applyCodeTheme>[0];
  }

  it("falls back to Monaco's stock pair before the first theme document resolves", () => {
    const defined: string[] = [];
    expect(
      applyCodeTheme(fakeMonaco(defined), { mode: "dark", theme: null }),
    ).toEqual({ name: "vs-dark", base: "vs-dark" });
    expect(defined).toEqual([]);
  });

  it("keys the widget base on the applied document, so a mid-switch frame stays coherent", () => {
    expect(
      applyCodeTheme(fakeMonaco([]), { mode: "dark", theme: theme() }).base,
    ).toBe("vs");
  });
});

describe("editorBackground", () => {
  it("prefers the declared workbench color over the theme's own pair", () => {
    expect(
      editorBackground(theme({ colors: { "editor.background": "#1e1e2e" } })),
    ).toBe("#1e1e2e");
  });

  it("falls back to the theme's background, and to nothing before one resolves", () => {
    expect(editorBackground(theme())).toBe("#eceff4");
    expect(editorBackground(null)).toBeNull();
  });

  it("reports nothing for a background the browser could not paint", () => {
    expect(
      editorBackground(
        theme({ bg: "not-a-color", colors: { "editor.background": "red" } }),
      ),
    ).toBeNull();
  });
});
