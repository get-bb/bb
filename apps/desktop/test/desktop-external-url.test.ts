import { mkdir, mkdtemp, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  openDesktopExternalUrl,
  registerDesktopExternalUrlIpc,
} from "../src/desktop-external-url.js";
import { BB_DESKTOP_OPEN_EXTERNAL_URL_CHANNEL } from "../src/desktop-update-ipc.js";

const electronMock = vi.hoisted(() => {
  type FakeIpcListener = (event: object, payload: unknown) => void;
  const listeners = new Map<string, FakeIpcListener>();
  return {
    listeners,
    ipcMain: {
      on(channel: string, listener: FakeIpcListener): void {
        listeners.set(channel, listener);
      },
    },
  };
});

vi.mock("electron", () => ({ ipcMain: electronMock.ipcMain }));

let tempDir = "";

beforeEach(async () => {
  electronMock.listeners.clear();
  tempDir = await mkdtemp(join(tmpdir(), "bb-desktop-external-url-"));
});

afterEach(async () => {
  await rm(tempDir, { force: true, recursive: true });
});

async function openAll(payloads: readonly unknown[]): Promise<string[]> {
  const opened: string[] = [];
  for (const payload of payloads) {
    await openDesktopExternalUrl(payload, async (url) => {
      opened.push(url);
    });
  }
  return opened;
}

describe("openDesktopExternalUrl", () => {
  it("opens web links and editor links to existing regular files", async () => {
    const file = join(tempDir, "review.diff");
    await writeFile(file, "diff");

    expect(
      await openAll([
        "https://example.com/docs",
        "mailto:hi@example.com",
        `devin://file${file}`,
        `vscode://file${file}:12:3`,
      ]),
    ).toEqual([
      "https://example.com/docs",
      "mailto:hi@example.com",
      `devin://file${file}`,
      `vscode://file${file}:12:3`,
    ]);
  });

  it("never forwards rejected URLs, directories or missing files to the native opener", async () => {
    const folder = join(tempDir, "folder");
    await mkdir(folder);

    expect(
      await openAll([
        `vscode://file${folder}`,
        `vscode://file${folder}:1`,
        `devin://file${join(tempDir, "missing.diff")}`,
        `vscode://file${tempDir}/..:1`,
        `vscode://file${tempDir}/review%2Ecode-workspace`,
        "javascript:alert(1)",
        "data:text/html,hi",
        "file:///Applications/Calculator.app",
        "ms-msdt:/id",
        "obsidian://open?vault=lake",
        "devin://chat-plugin/install?source=https://example.invalid/plugin",
        "vscode://vscode.git/clone?url=https://example.invalid/repo.git",
        "vscode://file/Users/me/app.ts?windowId=_blank",
        "devin://user@file/Users/me/app.ts",
        "devin://file/%2Fserver/share/a.diff",
        42,
        null,
      ]),
    ).toEqual([]);
  });

  it("checks the same path the editor opens when numeric suffixes are ambiguous", async () => {
    await writeFile(join(tempDir, "review"), "diff");
    await mkdir(join(tempDir, "review:1"));

    expect(
      await openAll([
        `vscode://file${tempDir}/review:1:2:3`,
        `vscode://file${tempDir}/review:1:2`,
      ]),
    ).toEqual([`vscode://file${tempDir}/review:1:2`]);
  });

  it("rejects colon pieces the editor would drop before stat", async () => {
    await mkdir(join(tempDir, "proj"));
    await writeFile(join(tempDir, "proj:"), "decoy");
    await mkdir(join(tempDir, "sub"));
    await writeFile(join(tempDir, "sub", "..:"), "decoy");
    await writeFile(join(tempDir, "notes:draft.md"), "notes");

    expect(
      await openAll([
        `vscode://file${tempDir}/proj:`,
        `vscode://file${tempDir}/sub/..:`,
        `vscode://file${tempDir}/notes:draft.md:3`,
      ]),
    ).toEqual([`vscode://file${tempDir}/notes:draft.md:3`]);
  });

  it.skipIf(process.platform === "win32")(
    "does not resolve Windows drive paths against the working directory",
    async () => {
      const relativeDrive = join(process.cwd(), "C:");
      const fileName = `bb-external-url-${process.pid}.diff`;
      await mkdir(relativeDrive, { recursive: true });
      await writeFile(join(relativeDrive, fileName), "diff");
      try {
        expect(await openAll([`cursor://file/C:/${fileName}`])).toEqual([]);
      } finally {
        await rm(join(relativeDrive, fileName), { force: true });
        await rmdir(relativeDrive).catch(() => undefined);
      }
    },
  );
});

describe("registerDesktopExternalUrlIpc", () => {
  it("routes renderer payloads through the external URL policy", async () => {
    const opened: string[] = [];
    registerDesktopExternalUrlIpc(async (url) => {
      opened.push(url);
    });
    const listener = electronMock.listeners.get(
      BB_DESKTOP_OPEN_EXTERNAL_URL_CHANNEL,
    );
    if (listener === undefined) {
      throw new Error("Expected open-external-url listener");
    }

    listener({}, "javascript:alert(1)");
    listener({}, `vscode://file${tempDir}`);
    listener({}, "https://example.com/docs");

    await vi.waitFor(() => {
      expect(opened).toEqual(["https://example.com/docs"]);
    });
  });
});
