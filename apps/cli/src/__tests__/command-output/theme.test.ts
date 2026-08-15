import { describe, expect, it, vi } from "vitest";
import {
  collectLogLines,
  collectLogPayloads,
  getHelpOutput,
  runCommand,
  setupCommandOutputTestEnvironment,
  stubServerApi,
  type CommandRegistrar,
} from "../helpers/command-output-harness.js";
import { registerThemeCommands } from "../../commands/theme.js";

describe("bb theme commands", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerThemeCommands(program, () => "http://server");

  function stubAppearance(themeId = "dracula", faviconColor = "purple") {
    const put = vi.fn(async ({ json }) => ({
      ...json,
      customCss: null,
      resolvedCodeTheme: {
        dark: "pierre-dark",
        light: "pierre-light",
        files: {},
      },
    }));
    stubServerApi({
      "v1.system.config.$get": vi.fn(async () => ({
        appearance: {
          themeId,
          faviconColor,
          customCss: null,
          resolvedCodeTheme: {
            dark: "pierre-dark",
            light: "pierre-light",
            files: {},
          },
        },
      })),
      "v1.settings.appearance.$put": put,
    });
    return put;
  }

  it("preserves the favicon color for a theme-only update", async () => {
    const put = stubAppearance();

    await runCommand(["theme", "set", "nord"], register);

    expect(put).toHaveBeenCalledWith({
      json: { themeId: "nord", faviconColor: "purple" },
    });
  });

  it("sends and prints a complete selection update as JSON", async () => {
    const put = stubAppearance();

    await runCommand(
      ["theme", "set", "nord", "--favicon-color", "teal", "--json"],
      register,
    );

    expect(put).toHaveBeenCalledWith({
      json: { themeId: "nord", faviconColor: "teal" },
    });
    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      JSON.stringify(
        {
          themeId: "nord",
          faviconColor: "teal",
          customCss: null,
          resolvedCodeTheme: {
            dark: "pierre-dark",
            light: "pierre-light",
            files: {},
          },
        },
        null,
        2,
      ),
    ]);
  });

  it("sets and resets the favicon color without changing the theme", async () => {
    const put = stubAppearance("plugin:palette:ocean", "purple");

    await runCommand(["theme", "favicon", "set", "blue"], register);
    await runCommand(["theme", "favicon", "reset"], register);

    expect(put).toHaveBeenNthCalledWith(1, {
      json: { themeId: "plugin:palette:ocean", faviconColor: "blue" },
    });
    expect(put).toHaveBeenNthCalledWith(2, {
      json: { themeId: "plugin:palette:ocean", faviconColor: "default" },
    });
  });

  it("resets the theme without resetting the favicon color", async () => {
    const put = stubAppearance("nord", "pink");

    await runCommand(["theme", "reset"], register);

    expect(put).toHaveBeenCalledWith({
      json: { themeId: "default", faviconColor: "pink" },
    });
  });

  it("rejects invalid favicon colors before writing", async () => {
    const put = stubAppearance();

    await expect(
      runCommand(["theme", "favicon", "set", "chartreuse"], register),
    ).rejects.toThrow("process.exit:1");
    await expect(
      runCommand(
        ["theme", "set", "nord", "--favicon-color", "chartreuse"],
        register,
      ),
    ).rejects.toThrow("process.exit:1");

    expect(put).not.toHaveBeenCalled();
    expect(collectLogLines(vi.mocked(console.error)).join("\n")).toContain(
      "Invalid favicon color 'chartreuse'",
    );
  });

  it("documents complete and independent appearance controls in help", async () => {
    const themeHelp = await getHelpOutput(["theme"], register);
    const setHelp = await getHelpOutput(["theme", "set"], register);
    const faviconHelp = await getHelpOutput(["theme", "favicon"], register);

    expect(themeHelp).toContain("favicon");
    expect(themeHelp).not.toContain("code-theme");
    expect(setHelp).toContain("--favicon-color <color>");
    expect(faviconHelp).toContain("set [options] <color>");
    expect(faviconHelp).toContain("reset");
  });
});
