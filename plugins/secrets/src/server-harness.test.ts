import { describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "./server.js";

describe("secrets plugin server", () => {
  it("requests multiple values once and writes them without returning them", async () => {
    let writtenContent = "";
    const host = createFakePluginHost({
      pluginId: "secrets",
      sdk: {
        threads: {
          async get() {
            return {
              host: { id: "host-test" },
            };
          },
        },
        files: {
          async read() {
            return {
              content: "OTHER=value\nAPI_KEY=old\n",
              contentEncoding: "utf8",
              sha256: "before",
            };
          },
          async write(args) {
            writtenContent = args.content;
            return { outcome: "written", sha256: "after", sizeBytes: 1 };
          },
        },
      },
    });
    plugin(host.bb as unknown as Parameters<typeof plugin>[0]);

    const command = host.harness.runCli(
      [
        "request",
        "API_KEY",
        "TOKEN",
        "--write-env",
        ".env.local",
        "--purpose",
        "Configure the app",
        "--describe",
        "API_KEY",
        "Primary API key",
      ],
      { threadId: "thr-test", cwd: "/outside/workspace/plugin" },
    );
    await vi.waitFor(() =>
      expect(host.harness.pendingInteractions).toHaveLength(1),
    );
    const pending = host.harness.pendingInteractions[0]!;
    expect(pending.payload).toMatchObject({
      purpose: "Configure the app",
      destination: {
        kind: "dotenv",
        path: "/outside/workspace/plugin/.env.local",
      },
      fields: [{ name: "API_KEY" }, { name: "TOKEN" }],
    });
    host.harness.submitInteraction(pending.id, {
      values: { API_KEY: "secret-one", TOKEN: "secret-two" },
    });

    const result = await command;
    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain("secret-one");
    expect(result.stdout).not.toContain("secret-two");
    expect(writtenContent).toContain("API_KEY='secret-one'");
    expect(writtenContent).toContain("TOKEN='secret-two'");
    const writeArgs = host.harness.sdk.callsTo("files.write")[0]?.[0];
    expect(writeArgs).toMatchObject({
      hostId: "host-test",
      path: "/outside/workspace/plugin/.env.local",
      expectedSha256: "before",
      mode: 0o600,
    });
    expect(writeArgs).not.toHaveProperty("rootPath");
    expect(JSON.parse(result.stdout ?? "")).toMatchObject({
      path: "/outside/workspace/plugin/.env.local",
    });
  });

  it("preserves an absolute dotenv destination outside the CLI working directory", async () => {
    const host = createFakePluginHost({
      pluginId: "secrets",
      sdk: {
        threads: {
          async get() {
            return { host: { id: "host-test" } };
          },
        },
        files: {
          async read() {
            return {
              content: "",
              contentEncoding: "utf8",
              sha256: "before",
            };
          },
        },
      },
    });
    plugin(host.bb as unknown as Parameters<typeof plugin>[0]);

    const command = host.harness.runCli(
      ["request", "API_KEY", "--write-env", "/var/plugin/.env"],
      { threadId: "thr-test", cwd: "/workspace" },
    );
    await vi.waitFor(() =>
      expect(host.harness.pendingInteractions).toHaveLength(1),
    );

    expect(host.harness.pendingInteractions[0]?.payload).toMatchObject({
      destination: { kind: "dotenv", path: "/var/plugin/.env" },
    });
    expect(host.harness.sdk.callsTo("files.read")[0]?.[0]).toEqual({
      hostId: "host-test",
      path: "/var/plugin/.env",
    });
    host.harness.cancelInteraction(host.harness.pendingInteractions[0]!.id);
    await command;
  });

  it.each([
    {
      argv: ["request", "API_KEY", "--purpose", "--write-env", ".env"],
      message: "--purpose requires a non-empty description.",
    },
    {
      argv: ["request", "API_KEY", "--describe", "--write-env", ".env"],
      message: "--describe requires NAME and DESCRIPTION.",
    },
  ])(
    "reports a usage error for missing option values",
    async ({ argv, message }) => {
      const host = createFakePluginHost({ pluginId: "secrets" });
      plugin(host.bb as unknown as Parameters<typeof plugin>[0]);

      const result = await host.harness.runCli(argv, {
        threadId: "thr-test",
        cwd: "/workspace",
      });

      expect(result).toMatchObject({ exitCode: 1, stderr: `${message}\n` });
      expect(host.harness.pendingInteractions).toEqual([]);
    },
  );
});
