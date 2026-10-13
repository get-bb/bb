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
    expect(pending.title).toBe("Add secrets");
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

  it("requests secrets from a working directory with a long absolute path", async () => {
    const cwd = `/${"deep-directory/".repeat(20)}workspace`;
    const destinationPath = `${cwd}/.env.local`;
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
      ["request", "API_KEY", "--write-env", ".env.local"],
      { threadId: "thr-test", cwd },
    );
    await vi.waitFor(() =>
      expect(host.harness.pendingInteractions).toHaveLength(1),
    );

    const pending = host.harness.pendingInteractions[0]!;
    expect(pending.title).toBe("Add secrets");
    expect(pending.payload).toMatchObject({
      destination: { kind: "dotenv", path: destinationPath },
    });
    expect(
      pending.describeSubmission?.({ values: { API_KEY: "s3cret" } }),
    ).toEqual({
      title: "Provided API_KEY",
      detail: `${destinationPath}\n- API_KEY`,
    });
    host.harness.cancelInteraction(pending.id);
    await command;
  });

  it("keeps the row label within its cap for many long secret names", async () => {
    const names = Array.from(
      { length: 12 },
      (_unused, index) => `A_VERY_LONG_SECRET_NAME_NUMBER_${index}`,
    );
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
            return { content: "", contentEncoding: "utf8", sha256: "before" };
          },
        },
      },
    });
    plugin(host.bb as unknown as Parameters<typeof plugin>[0]);

    const command = host.harness.runCli(
      ["request", ...names, "--write-env", ".env"],
      { threadId: "thr-test", cwd: "/workspace" },
    );
    await vi.waitFor(() =>
      expect(host.harness.pendingInteractions).toHaveLength(1),
    );

    const pending = host.harness.pendingInteractions[0]!;
    expect(pending.presentation?.label?.pending.length).toBeLessThanOrEqual(80);
    expect(pending.presentation?.label?.completed.length).toBeLessThanOrEqual(
      80,
    );
    host.harness.cancelInteraction(pending.id);
    await command;
  });

  it.each([
    {
      argv: ["request", "API_KEY", "--purpose", "--write-env", ".env"],
      message: "--purpose requires a value",
    },
    {
      argv: ["request", "API_KEY", "--describe", "--write-env", ".env"],
      message: "--describe requires a value",
    },
    {
      argv: ["request", "API_KEY", "--describe", "API_KEY"],
      message: "missing required options: --write-env",
    },
    {
      argv: ["request", "--write-env", ".env"],
      message: "missing required arguments: <name>",
    },
    {
      argv: ["request", "API_KEY", "--write-env", ".env", "--wrote-env", "x"],
      message: "unknown option '--wrote-env' (Did you mean --write-env?)",
    },
    {
      argv: [
        "request",
        "API_KEY",
        "--write-env",
        ".env",
        "--describe",
        "OTHER=text",
      ],
      message: "--describe references unrequested variable OTHER.",
    },
    {
      argv: ["request", "API_KEY", "API_KEY", "--write-env", ".env"],
      message: "Variable names must be unique.",
    },
    {
      argv: ["request", "1BAD", "--write-env", ".env"],
      message:
        "Variable name must start with a letter or underscore and contain only letters, digits, and underscores.",
    },
  ])(
    "reports a usage error for malformed invocation $argv",
    async ({ argv, message }) => {
      const host = createFakePluginHost({ pluginId: "secrets" });
      plugin(host.bb as unknown as Parameters<typeof plugin>[0]);

      const result = await host.harness.runCli(argv, {
        threadId: "thr-test",
        cwd: "/workspace",
      });

      expect(result.exitCode).toBe(1);
      expect(result.stderr.split("\n")[0]).toContain(message);
      expect(host.harness.pendingInteractions).toEqual([]);
    },
  );

  it("accepts --describe NAME=TEXT and reports failures as JSON with --json", async () => {
    const host = createFakePluginHost({ pluginId: "secrets" });
    plugin(host.bb as unknown as Parameters<typeof plugin>[0]);

    const result = await host.harness.runCli(
      [
        "request",
        "API_KEY",
        "--write-env",
        ".env",
        "--describe",
        "API_KEY=Primary API key",
        "--json",
      ],
      { cwd: "/workspace" },
    );

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({
      ok: false,
      error: {
        code: "missing_thread",
        message: "bb secret request must run from a bb thread.",
      },
    });
    expect(result.stderr).toBe(
      "bb secret request must run from a bb thread.\n",
    );
    expect(host.harness.pendingInteractions).toEqual([]);
  });

  it.each([["--help"], ["request", "--help"], ["help"]])(
    "documents %s without running the command",
    async (...argv) => {
      const host = createFakePluginHost({ pluginId: "secrets" });
      plugin(host.bb as unknown as Parameters<typeof plugin>[0]);

      const result = await host.harness.runCli(argv, {
        threadId: "thr-test",
        cwd: "/workspace",
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("bb secret request");
      expect(host.harness.pendingInteractions).toEqual([]);
    },
  );
});
