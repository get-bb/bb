import { describe, expect, it } from "vitest";
import { resolveFolderPickerCommand } from "./native-folder-picker.js";

const onPath =
  (...available: string[]) =>
  (command: string) =>
    available.includes(command) ? `/usr/bin/${command}` : null;

describe("resolveFolderPickerCommand", () => {
  it.each(["darwin", "win32"] as const)(
    "always offers the system picker on %s",
    (platform) => {
      expect(
        resolveFolderPickerCommand({ platform, resolveCommand: onPath() }),
      ).not.toBeNull();
    },
  );

  it("prefers zenity and falls back to kdialog on a Linux desktop", () => {
    const env = { DISPLAY: ":0" };
    expect(
      resolveFolderPickerCommand({
        platform: "linux",
        env,
        resolveCommand: onPath("zenity", "kdialog"),
      })?.command,
    ).toBe("/usr/bin/zenity");
    expect(
      resolveFolderPickerCommand({
        platform: "linux",
        env: { WAYLAND_DISPLAY: "wayland-0" },
        home: "/home/user",
        resolveCommand: onPath("kdialog"),
      }),
    ).toEqual({
      command: "/usr/bin/kdialog",
      args: [
        "--getexistingdirectory",
        "/home/user",
        "--title",
        "Choose a project folder",
      ],
      cancelExitCode: 1,
    });
  });

  it.each([
    ["a Linux machine without a display", "linux", {}, ["zenity"]],
    ["a Linux desktop without a picker", "linux", { DISPLAY: ":0" }, []],
    ["WSL", "wsl", { DISPLAY: ":0" }, ["zenity"]],
  ] as const)("offers no picker on %s", (_label, platform, env, available) => {
    expect(
      resolveFolderPickerCommand({
        platform,
        env,
        resolveCommand: onPath(...available),
      }),
    ).toBeNull();
  });
});
