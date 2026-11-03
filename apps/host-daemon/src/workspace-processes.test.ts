import { readFile, readdir, readlink, realpath, stat } from "node:fs/promises";
import { afterEach, expect, it, vi } from "vitest";
import { inspectWorkspaceProcesses } from "./workspace-processes.js";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
  readlink: vi.fn(),
  realpath: vi.fn(),
  stat: vi.fn(),
}));
afterEach(() => vi.resetAllMocks());

it.skipIf(process.platform !== "linux")(
  "finds same-user cwd and mapped paths without treating sibling paths or shared inodes as workspace use",
  async () => {
    const uid = process.getuid!();
    vi.mocked(realpath).mockResolvedValue("/workspace");
    vi.mocked(readdir).mockResolvedValue([
      "101",
      "102",
      "103",
      "104",
      "105",
      "106",
      "107",
      "self",
    ] as never);
    vi.mocked(readFile).mockImplementation(async (file) => {
      const name = String(file);
      if (name.endsWith("/status"))
        return `State:\tS (sleeping)\nUid:\t${name.includes("/106/") ? uid + 1 : uid}\t${uid + 1}\t${uid + 1}\t${uid + 1}\n`;
      const mapped = name.includes("/102/")
        ? "/workspace/lib.so (deleted)"
        : name.includes("/107/")
          ? "/workspace/a\\040b.so"
          : "/production/lib.so";
      return `1000-2000 r-xp 00000000 08:01 123 ${mapped}\n`;
    });
    vi.mocked(readlink).mockImplementation(async (file) =>
      String(file).includes("/101/")
        ? "/workspace (deleted)"
        : String(file).includes("/103/")
          ? "/workspace-other"
          : String(file).includes("/105/") || String(file).includes("/106/")
            ? "/workspace/subdir"
            : "/elsewhere",
    );
    expect(await inspectWorkspaceProcesses("/workspace-alias")).toEqual({
      supported: true,
      pids: [101, 102, 105, 107],
      unreadablePids: [],
    });
  },
);

it.skipIf(process.platform !== "linux")(
  "refuses unreadable same-user processes but tolerates an exited process",
  async () => {
    const uid = process.getuid!();
    vi.mocked(realpath).mockResolvedValue("/workspace");
    vi.mocked(readdir).mockResolvedValue(["201", "202", "203"] as never);
    vi.mocked(readFile).mockImplementation(async (file) => {
      if (String(file).includes("/203/"))
        throw Object.assign(new Error("gone"), { code: "ENOENT" });
      if (String(file).endsWith("/status"))
        return `State:\tS\nUid:\t${uid}\t${uid}\t${uid}\t${uid}\n`;
      throw Object.assign(new Error("denied"), { code: "EACCES" });
    });
    vi.mocked(readlink).mockImplementation(async (file) => {
      if (String(file).includes("/201/"))
        throw Object.assign(new Error("denied"), { code: "EACCES" });
      return "/elsewhere";
    });
    vi.mocked(stat).mockRejectedValue(
      Object.assign(new Error("gone"), { code: "ENOENT" }),
    );
    expect(await inspectWorkspaceProcesses("/workspace")).toEqual({
      supported: true,
      pids: [],
      unreadablePids: [201, 202],
    });
  },
);

it.skipIf(process.platform === "linux")(
  "refuses recovery where process inspection is unsupported",
  async () => {
    expect(await inspectWorkspaceProcesses("/workspace")).toEqual({
      supported: false,
      pids: [],
      unreadablePids: [],
    });
  },
);

it.skipIf(process.platform !== "linux").each([
  ["/literal\\040name", "/literal\\040name/lib.so", "/elsewhere"],
  ["/literal\\012name", "/literal\\012name/lib.so", "/elsewhere"],
  ["/newline\nname", "/newline\\012name/lib.so", "/elsewhere"],
  ["/workspace (deleted)", "/elsewhere/lib.so", "/workspace (deleted)"],
])(
  "preserves ambiguous proc pathnames for %s",
  async (workspace, mapped, cwd) => {
    const uid = process.getuid!();
    vi.mocked(realpath).mockResolvedValue(workspace);
    vi.mocked(readdir).mockResolvedValue(["301"] as never);
    vi.mocked(readFile).mockImplementation(async (file) =>
      String(file).endsWith("/status")
        ? `State:\tS\nUid:\t${uid}\t${uid}\t${uid}\t${uid}\n`
        : `1000-2000 r-xp 00000000 08:01 123 ${mapped}\n`,
    );
    vi.mocked(readlink).mockResolvedValue(cwd);
    expect(await inspectWorkspaceProcesses(workspace)).toEqual({
      supported: true,
      pids: [301],
      unreadablePids: [],
    });
  },
);
