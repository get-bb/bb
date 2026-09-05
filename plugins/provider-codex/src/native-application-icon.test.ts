import { access, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resolveNativeApplicationIconDataUrl } from "./native-application-icon.js";

const { execute } = vi.hoisted(() => ({
  execute:
    vi.fn<
      (
        file: string,
        args: string[],
        options: { timeout: number },
      ) => Promise<{ stdout: string }>
    >(),
}));

vi.mock("node:child_process", () => ({
  execFile: Object.assign(() => {}, {
    [Symbol.for("nodejs.util.promisify.custom")]: execute,
  }),
}));

const originalPlatform = process.platform;
beforeEach(() => {
  execute.mockReset();
  Object.defineProperty(process, "platform", { value: "darwin" });
});
afterEach(() => {
  Object.defineProperty(process, "platform", { value: originalPlatform });
});

it("resolves the host app by bundle ID and cleans up its thumbnail", async () => {
  let thumbnailDirectory = "";
  const iconBytes = Buffer.from("native-icon");
  execute.mockImplementation(async (file, args) => {
    if (file === "/usr/bin/osascript")
      return { stdout: "/Applications/Example App.app\n" };
    if (file === "/usr/bin/plutil") return { stdout: "AppIcon\n" };
    thumbnailDirectory = args[args.indexOf("-o") + 1];
    await writeFile(
      path.join(thumbnailDirectory, "AppIcon.icns.png"),
      iconBytes,
    );
    return { stdout: "" };
  });
  expect(
    await resolveNativeApplicationIconDataUrl("com.example.test'quoted"),
  ).toBe(`data:image/png;base64,${iconBytes.toString("base64")}`);
  expect(execute.mock.calls[0][1].at(-1)).toBe("com.example.test'quoted");
  expect(execute.mock.calls[1][1].at(-1)).toBe(
    "/Applications/Example App.app/Contents/Info.plist",
  );
  expect(execute.mock.calls[2][1].at(-1)).toBe(
    "/Applications/Example App.app/Contents/Resources/AppIcon.icns",
  );
  expect(execute.mock.calls.every((call) => call[2].timeout === 1_500)).toBe(
    true,
  );
  await expect(access(thumbnailDirectory)).rejects.toThrow();
});

it.each(["linux", "win32"])(
  "does not run macOS commands on %s",
  async (platform) => {
    Object.defineProperty(process, "platform", { value: platform });
    expect(
      await resolveNativeApplicationIconDataUrl("com.example.app"),
    ).toBeNull();
    expect(execute).not.toHaveBeenCalled();
  },
);

it.each(["", "relative/Example.app", "/Applications/Example.txt"])(
  "skips unavailable or invalid app paths: %s",
  async (stdout) => {
    execute.mockResolvedValue({ stdout });
    expect(
      await resolveNativeApplicationIconDataUrl("com.example.app"),
    ).toBeNull();
    expect(execute).toHaveBeenCalledTimes(1);
  },
);

it("treats a failed or timed-out lookup as an unavailable icon", async () => {
  execute.mockRejectedValue(new Error("timed out"));
  expect(
    await resolveNativeApplicationIconDataUrl("com.example.app"),
  ).toBeNull();
});

it.each(["../../other.icns", "/tmp/icon.icns", ""])(
  "rejects invalid bundle icon filenames: %s",
  async (stdout) => {
    execute
      .mockResolvedValueOnce({ stdout: "/Applications/Example.app" })
      .mockResolvedValueOnce({ stdout });
    expect(
      await resolveNativeApplicationIconDataUrl("com.example.app"),
    ).toBeNull();
    expect(execute).toHaveBeenCalledTimes(2);
  },
);

it("drops oversized thumbnails and cleans up temporary files", async () => {
  let thumbnailDirectory = "";
  execute.mockImplementation(async (file, args) => {
    if (file === "/usr/bin/osascript")
      return { stdout: "/Applications/Example.app" };
    if (file === "/usr/bin/plutil") return { stdout: "AppIcon.icns" };
    thumbnailDirectory = args[args.indexOf("-o") + 1];
    await writeFile(
      path.join(thumbnailDirectory, "AppIcon.icns.png"),
      Buffer.alloc(200_000),
    );
    return { stdout: "" };
  });
  expect(
    await resolveNativeApplicationIconDataUrl("com.example.app"),
  ).toBeNull();
  await expect(access(thumbnailDirectory)).rejects.toThrow();
});
