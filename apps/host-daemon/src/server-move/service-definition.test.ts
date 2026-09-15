import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildServerStartArguments,
  findServiceDefinition,
  formatSystemdUnit,
  isServerStartDefinition,
  parseLaunchdPlist,
  parseSystemdUnit,
  readHostDaemonPortArgument,
  replaceServerUrlArgument,
  writeServiceDefinition,
} from "./service-definition.js";

const roots: string[] = [];

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "bb-service-definition-test-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function systemdUnit(args: { dataDir: string; serverUrl: string }): string {
  return `[Unit]
Description=bb host daemon for old-server.local
After=network-online.target
Wants=network-online.target

[Service]
ExecStart="/opt/node 22/bin/node" "/home/me/.bb-machines/npm/bin/bb-app" host-daemon --auto-update --host-daemon-port "38887" --server-url "${args.serverUrl}"
Environment="BB_APP_NPM_PREFIX=/home/me/.bb-machines/npm"
Environment="BB_DATA_DIR=${args.dataDir}"
Restart=always
RestartSec=2

[Install]
WantedBy=default.target
`;
}

function launchdPlist(args: { dataDir: string; serverUrl: string }): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>app.getbb.host-daemon.old-server-me</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/Users/me/.bb-machines/npm/bin/bb-app</string>
    <string>host-daemon</string>
    <string>--auto-update</string>
    <string>--host-daemon-port</string>
    <string>38887</string>
    <string>--server-url</string>
    <string>${args.serverUrl}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>BB_APP_NPM_PREFIX</key><string>/Users/me/.bb-machines/npm</string>
    <key>BB_DATA_DIR</key><string>${args.dataDir}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${args.dataDir}/logs/launchd.log</string>
  <key>StandardErrorPath</key><string>${args.dataDir}/logs/launchd.log</string>
</dict>
</plist>
`;
}

describe("findServiceDefinition", () => {
  it("finds the systemd user unit whose BB_DATA_DIR is this daemon's data dir", async () => {
    const homeDir = await createRoot();
    const dataDir = join(homeDir, ".bb-machines", "old-server");
    const otherDataDir = join(homeDir, ".bb-machines", "other-server");
    await mkdir(dataDir, { recursive: true });
    await mkdir(otherDataDir, { recursive: true });
    const unitDir = join(homeDir, ".config", "systemd", "user");
    await mkdir(unitDir, { recursive: true });
    await writeFile(
      join(unitDir, "bb-host-daemon-another-me.service"),
      systemdUnit({ dataDir: otherDataDir, serverUrl: "http://other:38886" }),
    );
    await writeFile(
      join(unitDir, "bb-host-daemon-old-server-me.service"),
      systemdUnit({ dataDir, serverUrl: "http://old-server.local:38886" }),
    );
    await writeFile(
      join(unitDir, "unrelated.service"),
      systemdUnit({ dataDir, serverUrl: "http://old-server.local:38886" }),
    );

    const definition = await findServiceDefinition({
      dataDir,
      homeDir,
      platform: "linux",
      env: {},
    });

    expect(definition).toMatchObject({
      manager: "systemd-user",
      path: join(unitDir, "bb-host-daemon-old-server-me.service"),
      unitName: "bb-host-daemon-old-server-me.service",
      programArguments: [
        "/opt/node 22/bin/node",
        "/home/me/.bb-machines/npm/bin/bb-app",
        "host-daemon",
        "--auto-update",
        "--host-daemon-port",
        "38887",
        "--server-url",
        "http://old-server.local:38886",
      ],
      environment: {
        BB_APP_NPM_PREFIX: "/home/me/.bb-machines/npm",
        BB_DATA_DIR: dataDir,
      },
    });
  });

  it("finds a system-scope unit stored under the data dir", async () => {
    const homeDir = await createRoot();
    const dataDir = join(homeDir, "data");
    await mkdir(join(dataDir, "systemd"), { recursive: true });
    await writeFile(
      join(dataDir, "systemd", "bb-host-daemon-root.service"),
      systemdUnit({ dataDir, serverUrl: "http://old:38886" }),
    );

    const definition = await findServiceDefinition({
      dataDir,
      homeDir,
      platform: "linux",
      env: {},
    });

    expect(definition?.manager).toBe("systemd-system");
    expect(definition?.unitName).toBe("bb-host-daemon-root.service");
  });

  it("finds the launch agent on macOS and decodes XML escapes", async () => {
    const homeDir = await createRoot();
    const dataDir = join(homeDir, "bb & data");
    await mkdir(dataDir, { recursive: true });
    const agentsDir = join(homeDir, "Library", "LaunchAgents");
    await mkdir(agentsDir, { recursive: true });
    await writeFile(
      join(agentsDir, "app.getbb.host-daemon.old-server-me.plist"),
      launchdPlist({
        dataDir: dataDir.replace("&", "&amp;"),
        serverUrl: "https://old.example.test/?a=1&amp;b=2",
      }),
    );

    const definition = await findServiceDefinition({
      dataDir,
      homeDir,
      platform: "darwin",
      env: {},
    });

    expect(definition).toMatchObject({
      manager: "launchd",
      unitName: "app.getbb.host-daemon.old-server-me",
      environment: { BB_DATA_DIR: dataDir },
    });
    expect(definition?.programArguments.at(-1)).toBe(
      "https://old.example.test/?a=1&b=2",
    );
  });

  it("reports no definition when BB_SERVER_MOVE_SERVICE_MANAGER=none", async () => {
    const homeDir = await createRoot();
    const dataDir = join(homeDir, "data");
    const unitDir = join(homeDir, ".config", "systemd", "user");
    await mkdir(unitDir, { recursive: true });
    await mkdir(dataDir, { recursive: true });
    await writeFile(
      join(unitDir, "bb-host-daemon-x.service"),
      systemdUnit({ dataDir, serverUrl: "http://old:38886" }),
    );

    await expect(
      findServiceDefinition({
        dataDir,
        homeDir,
        platform: "linux",
        env: { BB_SERVER_MOVE_SERVICE_MANAGER: "none" },
      }),
    ).resolves.toBeNull();
  });
});

describe("service definition rewrites", () => {
  it("rewrites --server-url in a systemd unit and keeps the rest of the unit", async () => {
    const homeDir = await createRoot();
    const dataDir = join(homeDir, "data 100%");
    await mkdir(dataDir, { recursive: true });
    const unitDir = join(homeDir, ".config", "systemd", "user");
    await mkdir(unitDir, { recursive: true });
    const unitPath = join(unitDir, "bb-host-daemon-x.service");
    await writeFile(
      unitPath,
      systemdUnit({
        dataDir: dataDir.replace("%", "%%"),
        serverUrl: "http://old:38886",
      }),
      { mode: 0o644 },
    );
    const definition = await findServiceDefinition({
      dataDir,
      homeDir,
      platform: "linux",
      env: {},
    });
    if (definition === null) {
      throw new Error("Expected a service definition");
    }

    await writeServiceDefinition(
      definition,
      replaceServerUrlArgument(
        definition.programArguments,
        "https://new.example.test",
      ),
    );

    const content = await readFile(unitPath, "utf8");
    expect(content).toContain(
      'ExecStart="/opt/node 22/bin/node" "/home/me/.bb-machines/npm/bin/bb-app" "host-daemon" "--auto-update" "--host-daemon-port" "38887" "--server-url" "https://new.example.test"',
    );
    expect(content).toContain(
      `Environment="BB_DATA_DIR=${dataDir.replace("%", "%%")}"`,
    );
    expect(content).toContain("Restart=always");
    expect(content).toContain("WantedBy=default.target");
    expect((await stat(unitPath)).mode & 0o777).toBe(0o644);
    const reparsed = parseSystemdUnit(content, "bb-host-daemon-x.service");
    expect(reparsed?.programArguments.at(-1)).toBe("https://new.example.test");
    expect(reparsed?.environment.BB_DATA_DIR).toBe(dataDir);
  });

  it("swaps a launch agent to bb-app start with the same label and environment", async () => {
    const homeDir = await createRoot();
    const dataDir = join(homeDir, "data");
    await mkdir(dataDir, { recursive: true });
    const agentsDir = join(homeDir, "Library", "LaunchAgents");
    await mkdir(agentsDir, { recursive: true });
    const plistPath = join(
      agentsDir,
      "app.getbb.host-daemon.old-server-me.plist",
    );
    await writeFile(
      plistPath,
      launchdPlist({ dataDir, serverUrl: "http://old:38886" }),
    );
    const definition = await findServiceDefinition({
      dataDir,
      homeDir,
      platform: "darwin",
      env: {},
    });
    if (definition === null) {
      throw new Error("Expected a service definition");
    }
    expect(readHostDaemonPortArgument(definition.programArguments)).toBe(
      38_887,
    );

    const updated = await writeServiceDefinition(
      definition,
      buildServerStartArguments(definition.programArguments, {
        dataDir,
        serverPort: 38_886,
        hostDaemonPort: 38_887,
        bindHost: "0.0.0.0",
      }),
    );

    const reparsed = parseLaunchdPlist(await readFile(plistPath, "utf8"));
    expect(reparsed).toEqual({
      unitName: "app.getbb.host-daemon.old-server-me",
      programArguments: [
        "/usr/local/bin/node",
        "/Users/me/.bb-machines/npm/bin/bb-app",
        "start",
        "--data-dir",
        dataDir,
        "--server-port",
        "38886",
        "--host-daemon-port",
        "38887",
        "--server-bind-host",
        "0.0.0.0",
      ],
      environment: {
        BB_APP_NPM_PREFIX: "/Users/me/.bb-machines/npm",
        BB_DATA_DIR: dataDir,
      },
    });
    expect(isServerStartDefinition(updated)).toBe(true);
    expect(await readFile(plistPath, "utf8")).toContain(
      "<key>KeepAlive</key><true/>",
    );
  });

  it("rewrites --server-url in a launch agent with XML escaping", async () => {
    const homeDir = await createRoot();
    const dataDir = join(homeDir, "data");
    await mkdir(dataDir, { recursive: true });
    const agentsDir = join(homeDir, "Library", "LaunchAgents");
    await mkdir(agentsDir, { recursive: true });
    const plistPath = join(
      agentsDir,
      "app.getbb.host-daemon.old-server-me.plist",
    );
    await writeFile(
      plistPath,
      launchdPlist({ dataDir, serverUrl: "http://old:38886" }),
    );
    const definition = await findServiceDefinition({
      dataDir,
      homeDir,
      platform: "darwin",
      env: {},
    });
    if (definition === null) {
      throw new Error("Expected a service definition");
    }

    await writeServiceDefinition(
      definition,
      replaceServerUrlArgument(
        definition.programArguments,
        "https://new.example.test/?a=1&b=2",
      ),
    );

    const content = await readFile(plistPath, "utf8");
    expect(content).toContain(
      "<string>https://new.example.test/?a=1&amp;b=2</string>",
    );
    expect(parseLaunchdPlist(content)?.programArguments).toEqual([
      "/usr/local/bin/node",
      "/Users/me/.bb-machines/npm/bin/bb-app",
      "host-daemon",
      "--auto-update",
      "--host-daemon-port",
      "38887",
      "--server-url",
      "https://new.example.test/?a=1&b=2",
    ]);
    expect(content).toContain(
      `<key>BB_DATA_DIR</key><string>${dataDir}</string>`,
    );
  });

  it("builds bb-app start arguments without a bind host", () => {
    expect(
      buildServerStartArguments(
        [
          "node",
          "/prefix/bin/bb-app",
          "host-daemon",
          "--server-url",
          "http://old",
        ],
        {
          dataDir: "/data",
          serverPort: 39_001,
          hostDaemonPort: 39_002,
          bindHost: null,
        },
      ),
    ).toEqual([
      "node",
      "/prefix/bin/bb-app",
      "start",
      "--data-dir",
      "/data",
      "--server-port",
      "39001",
      "--host-daemon-port",
      "39002",
    ]);
  });

  it("rewrites both --server-url forms", () => {
    expect(
      replaceServerUrlArgument(
        [
          "bb-app",
          "host-daemon",
          "--server=http://old",
          "--server-url",
          "http://old",
        ],
        "http://new",
      ),
    ).toEqual([
      "bb-app",
      "host-daemon",
      "--server=http://new",
      "--server-url",
      "http://new",
    ]);
  });

  it("escapes $ for systemd and refuses arguments with line breaks", () => {
    const unit = [
      "[Service]",
      'ExecStart="/usr/bin/node" "/opt/npm/bin/bb-app" host-daemon',
      "",
    ].join("\n");
    const formatted = formatSystemdUnit(unit, [
      "/usr/bin/node",
      "/opt/npm/bin/bb-app",
      "host-daemon",
      "--server-url",
      "https://gate.example.test/$HOME%",
    ]);

    expect(formatted).toContain('"https://gate.example.test/$$HOME%%"');
    expect(
      parseSystemdUnit(formatted, "x.service")?.programArguments.at(-1),
    ).toBe("https://gate.example.test/$HOME%");
    expect(() =>
      formatSystemdUnit(unit, [
        "/usr/bin/node",
        "--server-url",
        "http://new.example.test\nExecStartPre=/bin/sh",
      ]),
    ).toThrow("line break");
  });
});
