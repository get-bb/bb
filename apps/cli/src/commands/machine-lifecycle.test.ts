import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runMachineLifecycle } from "./machine-lifecycle.js";

const homes: string[] = [];
afterEach(async () => {
  await Promise.all(
    homes.splice(0).map((home) => rm(home, { recursive: true, force: true })),
  );
});

async function fixture(
  platform: NodeJS.Platform = "linux",
  withService = true,
  system = false,
) {
  await mkdir("/tmp/pr2", { recursive: true });
  const homeDir = await realpath(await mkdtemp("/tmp/pr2/machine-lifecycle-"));
  homes.push(homeDir);
  const dataDir = join(homeDir, ".bb-machines", "owned");
  const launcher = join(dataDir, "npm", "bin", "bb-app");
  await mkdir(join(dataDir, "npm", "bin"), { recursive: true });
  await writeFile(launcher, "");
  await writeFile(
    join(dataDir, "auth.json"),
    JSON.stringify({ hostId: "host_one" }),
  );
  await writeFile(
    join(dataDir, "config.json"),
    JSON.stringify({ serverUrl: "https://bb.example" }),
  );
  await writeFile(join(dataDir, "host-daemon-port"), "44001\n");
  const servicePath =
    platform === "darwin"
      ? join(
          homeDir,
          "Library",
          "LaunchAgents",
          "app.getbb.host-daemon.bb-example-host_one.plist",
        )
      : system ? join(dataDir, "systemd", "bb-host-daemon-bb-example-host_one.service") : join(
          homeDir,
          ".config",
          "systemd",
          "user",
          "bb-host-daemon-bb-example-host_one.service",
        );
  await mkdir(join(servicePath, ".."), { recursive: true });
  if (withService)
    await writeFile(
      servicePath,
      platform === "darwin"
        ? `<key>BB_DATA_DIR</key><string>${dataDir}</string>`
        : `Environment="BB_DATA_DIR=${dataDir}"\nExecStart="/usr/bin/node" "${launcher}" host-daemon --auto-update --host-daemon-port "44001" --server-url "https://bb.example"`,
    );
  const reservation = join(
    homeDir,
    ".bb-machines",
    "host-daemon-ports",
    "44001",
  );
  await mkdir(reservation, { recursive: true });
  await writeFile(join(reservation, "data-dir"), dataDir);
  const calls: string[] = [];
  const state = {
    active: true,
    process: withService
      ? ""
      : `${launcher} host-daemon --auto-update --host-daemon-port 44001 --server-url https://bb.example`,
    statusHostId: "host_one",
  };
  if (!withService)
    await writeFile(join(dataDir, "install-daemon.pid"), "1234\n");
  const deps: NonNullable<Parameters<typeof runMachineLifecycle>[2]> = {
    homeDir,
    platform,
    uid: system ? 0 : 501,
    async run(command, args) {
      calls.push([command, ...args].join(" "));
      if (command === "ps") return state.process;
      if (args.includes("--property=FragmentPath")) return servicePath;
      if (
        args.includes("stop") ||
        args.includes("disable") ||
        args.includes("bootout")
      )
        state.active = false;
      if (args.includes("start") || args.includes("bootstrap"))
        state.active = true;
      return "";
    },
    status: async () =>
      state.active
        ? { hostId: state.statusHostId, serverUrl: "https://bb.example" }
        : null,
    kill(pid) {
      calls.push(`kill ${pid}`);
      state.active = false;
      state.process = "";
    },
    async start(command, args, directory) {
      calls.push(`start ${command} ${args.join(" ")} ${directory}`);
      state.active = true;
      return 5678;
    },
    sleep: async () => {},
  };
  return { homeDir, dataDir, servicePath, reservation, calls, state, deps };
}

const options = { hostId: "host_one" };
describe("owned local machine lifecycle", () => {
  it("starts after reboot, stops, and uninstalls an owned system unit", async () => {
    const f = await fixture("linux", true, true);
    f.state.active = false;
    await runMachineLifecycle("start", options, f.deps);
    expect(f.calls).toContain("systemctl --system start bb-host-daemon-bb-example-host_one.service");
    await runMachineLifecycle("stop", options, f.deps);
    expect(f.calls).toContain("systemctl --system stop bb-host-daemon-bb-example-host_one.service");
    expect(await readFile(f.servicePath, "utf8")).toContain("BB_DATA_DIR");
    await runMachineLifecycle("start", options, f.deps);
    await runMachineLifecycle("uninstall", options, f.deps);
    expect(f.calls).toContain("systemctl --system disable --now bb-host-daemon-bb-example-host_one.service");
    expect(f.calls).toContain("systemctl --system daemon-reload");
    await expect(readFile(f.servicePath)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("refuses a system service with another server command before stopping it", async () => {
    const f = await fixture("linux", true, true);
    const text = await readFile(f.servicePath, "utf8");
    await writeFile(f.servicePath, text.replace("https://bb.example", "https://other.example"));
    await expect(runMachineLifecycle("uninstall", options, f.deps)).rejects.toThrow("command belongs");
    expect(f.calls).toEqual([]);
  });
  it("refuses a system manager unit loaded from another path", async () => {
    const f = await fixture("linux", true, true);
    const other = join(f.homeDir, "another.service");
    await writeFile(other, "unrelated");
    const run = f.deps.run;
    f.deps.run = async (command, args) =>
      args.includes("--property=FragmentPath") ? other : run(command, args);
    await expect(runMachineLifecycle("uninstall", options, f.deps)).rejects.toThrow("loaded another");
    expect(f.calls).toEqual([]);
  });
  it("cleans a system unit left before enable without touching another service", async () => {
    const f = await fixture("linux", true, true);
    f.state.active = false;
    const run = f.deps.run;
    f.deps.run = async (command, args) =>
      args.includes("--property=FragmentPath") ? "" : run(command, args);
    await runMachineLifecycle("uninstall", options, f.deps);
    expect(f.calls).toEqual(["systemctl --system daemon-reload"]);
    await expect(readFile(f.servicePath)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("refuses system service control without root", async () => {
    const f = await fixture("linux", true, true);
    f.deps.uid = 501;
    await expect(runMachineLifecycle("stop", options, f.deps)).rejects.toThrow("requires root");
    expect(f.calls).toEqual([]);
  });

  it.each(["linux", "darwin"] as const)(
    "uninstalls only the host-specific %s service",
    async (platform) => {
      const f = await fixture(platform);
      const other = `${f.servicePath}.other`;
      await writeFile(other, "unrelated");
      await runMachineLifecycle("uninstall", options, f.deps);
      expect(await readFile(other, "utf8")).toBe("unrelated");
      await expect(
        readFile(join(f.dataDir, "auth.json")),
      ).rejects.toMatchObject({ code: "ENOENT" });
      await expect(
        readFile(join(f.reservation, "data-dir")),
      ).rejects.toMatchObject({ code: "ENOENT" });
      expect(f.calls.some((call) => call.includes("host_one"))).toBe(true);
      await runMachineLifecycle("uninstall", options, f.deps);
    },
  );
  it("retains a port reservation owned by another installation", async () => {
    const f = await fixture();
    await writeFile(join(f.reservation, "data-dir"), "/other");
    await runMachineLifecycle("uninstall", options, f.deps);
    expect(await readFile(join(f.reservation, "data-dir"), "utf8")).toBe(
      "/other",
    );
  });
  it("refuses a different server before stopping anything", async () => {
    const f = await fixture();
    await expect(
      runMachineLifecycle(
        "uninstall",
        { ...options, serverUrl: "https://other.example" },
        f.deps,
      ),
    ).rejects.toThrow("another server");
    expect(f.calls).toEqual([]);
  });
  it("refuses a different host in an explicitly selected directory", async () => {
    const f = await fixture();
    await expect(
      runMachineLifecycle(
        "uninstall",
        { hostId: "host_other", dataDir: f.dataDir },
        f.deps,
      ),
    ).rejects.toThrow("another host");
    expect(f.calls).toEqual([]);
  });
  it("refuses the default instance directory", async () => {
    const f = await fixture();
    const other = join(f.homeDir, ".bb");
    await mkdir(other);
    await writeFile(
      join(other, "auth.json"),
      JSON.stringify({ hostId: "host_one" }),
    );
    await expect(
      runMachineLifecycle("uninstall", { ...options, dataDir: other }, f.deps),
    ).rejects.toThrow("installer-owned root");
    expect(f.calls).toEqual([]);
  });
  it("refuses symlinked machine directories", async () => {
    const f = await fixture();
    const alias = join(f.homeDir, ".bb-machines", "alias");
    await symlink(f.dataDir, alias);
    await expect(
      runMachineLifecycle("uninstall", { ...options, dataDir: alias }, f.deps),
    ).rejects.toThrow("installer-owned root");
    expect(f.calls).toEqual([]);
  });
  it("refuses duplicate host identities", async () => {
    const f = await fixture();
    const other = join(f.homeDir, ".bb-machines", "duplicate");
    await mkdir(other);
    await writeFile(
      join(other, "auth.json"),
      JSON.stringify({ hostId: "host_one" }),
    );
    await writeFile(
      join(other, "config.json"),
      JSON.stringify({ serverUrl: "https://bb.example" }),
    );
    await expect(
      runMachineLifecycle("uninstall", options, f.deps),
    ).rejects.toThrow("multiple");
    expect(f.calls).toEqual([]);
  });
  it("refuses service files targeting another data directory", async () => {
    const f = await fixture();
    await writeFile(f.servicePath, 'Environment="BB_DATA_DIR=/other"');
    await expect(
      runMachineLifecycle("uninstall", options, f.deps),
    ).rejects.toThrow("service belongs");
    expect(f.calls).toEqual([]);
  });
  it("refuses a reused daemon port", async () => {
    const f = await fixture();
    f.state.statusHostId = "host_other";
    await expect(
      runMachineLifecycle("uninstall", options, f.deps),
    ).rejects.toThrow("port belongs");
    expect(f.calls).toEqual([]);
  });
  it("refuses a reused PID without killing it", async () => {
    const f = await fixture("linux", false);
    f.state.process = "/usr/bin/unrelated";
    await expect(
      runMachineLifecycle("uninstall", options, f.deps),
    ).rejects.toThrow("PID belongs");
    expect(f.calls.some((call) => call.startsWith("kill"))).toBe(false);
  });
  it("stops a verified container daemon and retains identity", async () => {
    const f = await fixture("linux", false);
    await runMachineLifecycle("stop", options, f.deps);
    expect(f.calls).toContain("kill 1234");
    expect(await readFile(join(f.dataDir, "auth.json"), "utf8")).toContain(
      "host_one",
    );
    expect(await readFile(join(f.reservation, "data-dir"), "utf8")).toBe(
      f.dataDir,
    );
  });
  it("starts a stopped container daemon using its private installation", async () => {
    const f = await fixture("linux", false);
    f.state.active = false;
    f.state.process = "";
    await runMachineLifecycle("start", options, f.deps);
    expect(
      f.calls.some((call) =>
        call.startsWith(`start ${f.dataDir}/npm/bin/bb-app`),
      ),
    ).toBe(true);
    expect(await readFile(join(f.dataDir, "install-daemon.pid"), "utf8")).toBe(
      "5678\n",
    );
  });
  it("retains files when stopping fails", async () => {
    const f = await fixture();
    f.deps.run = async () => {
      throw new Error("service manager failure");
    };
    await expect(
      runMachineLifecycle("uninstall", options, f.deps),
    ).rejects.toThrow("service manager failure");
    expect(await readFile(join(f.dataDir, "auth.json"), "utf8")).toContain(
      "host_one",
    );
  });
});
