import { describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@bb/plugin-sdk/testing";
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
              environment: { path: "/workspace" },
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
      { threadId: "thr-test", cwd: "/workspace" },
    );
    await vi.waitFor(() =>
      expect(host.harness.pendingInteractions).toHaveLength(1),
    );
    const pending = host.harness.pendingInteractions[0]!;
    expect(pending.payload).toMatchObject({
      purpose: "Configure the app",
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
    expect(host.harness.sdk.callsTo("files.write")[0]?.[0]).toMatchObject({
      expectedSha256: "before",
      mode: 0o600,
    });
  });
});
