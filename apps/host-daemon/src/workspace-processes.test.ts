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

it.skipIf(process.platform === "linux" || process.platform === "darwin")(
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

it.skipIf(process.platform !== "linux")(
  "refuses an unreadable process only when its mounts can reach the workspace",
  async () => {
    const uid = process.getuid!();
    const ownMounts =
      "22 1 253:0 / / rw,relatime - xfs /dev/vda1 rw\n" +
      "30 22 0:40 / /tmp rw - tmpfs tmpfs rw\n";
    const mountsByPid: Record<string, string | Error> = {
      "401": ownMounts,
      "402":
        "900 800 0:60 / / rw - overlay overlay rw\n" +
        "901 900 253:0 /home/user/workspace /app rw - xfs /dev/vda1 rw\n",
      "403":
        "910 810 0:61 / / rw - overlay overlay rw\n" +
        "911 910 253:0 /home/user/other /data rw - xfs /dev/vda1 rw\n",
      "404":
        "920 820 0:62 / / rw - overlay overlay rw\n" +
        "921 920 253:0 /home/user /home/user rw - xfs /dev/vda1 rw\n",
      "405": Object.assign(new Error("denied"), { code: "EACCES" }),
      "406":
        "930 830 0:63 / / rw - overlay overlay rw\n" +
        "931 930 0:40 / /tmp rw - tmpfs tmpfs rw\n",
    };
    vi.mocked(realpath).mockResolvedValue("/home/user/workspace");
    vi.mocked(readdir).mockResolvedValue(Object.keys(mountsByPid) as never);
    vi.mocked(readFile).mockImplementation(async (file) => {
      const name = String(file);
      if (name === "/proc/self/mountinfo") return ownMounts;
      if (name.endsWith("/status"))
        return `State:\tS\nUid:\t${uid}\t${uid}\t${uid}\t${uid}\n`;
      if (name.endsWith("/mountinfo")) {
        const mounts = mountsByPid[name.split("/")[2]!]!;
        if (mounts instanceof Error) throw mounts;
        return mounts;
      }
      throw Object.assign(new Error("denied"), { code: "EACCES" });
    });
    vi.mocked(readlink).mockImplementation(async (file) => {
      if (String(file) === "/proc/self/ns/mnt") return "mnt:[4026531841]";
      throw Object.assign(new Error("denied"), { code: "EACCES" });
    });
    expect(await inspectWorkspaceProcesses("/home/user/workspace")).toEqual({
      supported: true,
      pids: [],
      unreadablePids: [402, 404, 405],
    });
  },
);

it.skipIf(process.platform !== "linux")(
  "does not refuse for an unreadable process running under another effective UID",
  async () => {
    const uid = process.getuid!();
    vi.mocked(realpath).mockResolvedValue("/workspace");
    vi.mocked(readdir).mockResolvedValue(["501"] as never);
    vi.mocked(readFile).mockImplementation(async (file) => {
      if (String(file).endsWith("/status"))
        return `State:\tS\nUid:\t${uid}\t0\t0\t0\n`;
      throw Object.assign(new Error("denied"), { code: "EACCES" });
    });
    vi.mocked(readlink).mockRejectedValue(
      Object.assign(new Error("denied"), { code: "EACCES" }),
    );
    expect(await inspectWorkspaceProcesses("/workspace")).toEqual({
      supported: true,
      pids: [],
      unreadablePids: [],
    });
  },
);
