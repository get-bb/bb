import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { providerUsageResultSchema } from "@bb/provider-bridge-protocol";
import { captureBridgeJsonRpcOutput } from "@bb/provider-bridge-protocol/testing";
import { readAntigravityUsage } from "./antigravity-usage.js";
import { getAcpProviderUsage } from "./provider-maintenance.js";

let directory: string;
let command: string;
let env: NodeJS.ProcessEnv;
const response = {
  status: "SUCCESS",
  num_turns: 0,
  command: {
    name: "usage",
    data: {
      groups: [
        {
          name: "Gemini Models",
          buckets: [
            {
              name: "Weekly Limit Remaining",
              window: "weekly",
              remaining_fraction: 0.625,
              reset_time: "2026-11-28T16:27:36Z",
            },
            {
              name: "Five Hour Limit Remaining",
              window: "5h",
              remaining_fraction: 0,
              reset_time: "2026-11-21T21:27:36Z",
            },
          ],
        },
        {
          name: "Claude and GPT models",
          buckets: [
            {
              name: "Weekly Limit Remaining",
              window: "weekly",
              remaining_fraction: 1,
            },
          ],
        },
      ],
    },
  },
};

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "bb-antigravity-usage-"));
  const script = path.join(directory, "usage.cjs");
  await fs.writeFile(
    script,
    `
    require("node:fs").readFileSync(0);
    if (JSON.stringify(process.argv.slice(2)) !== JSON.stringify(["-p", "/usage", "--output-format", "json", "--print-timeout", "15s"])) process.exit(2);
    if (process.env.BB_TEST_AGY_ENV !== "launch-env") process.exit(3);
    process.stdout.write(process.env.BB_TEST_AGY_OUTPUT);
    if (process.env.BB_TEST_AGY_FAIL) { process.stderr.write("secret-token"); process.exit(1); }
  `,
  );
  command = path.join(
    directory,
    process.platform === "win32" ? "agy.cmd" : "agy",
  );
  await fs.writeFile(
    command,
    process.platform === "win32"
      ? `@echo off\r\n"${process.execPath}" "%~dp0usage.cjs" %*\r\n`
      : `#!/bin/sh\nexec '${process.execPath.replaceAll("'", "'\\''")}' '${script.replaceAll("'", "'\\''")}' "$@"\n`,
    { mode: 0o755 },
  );
  env = {
    ...process.env,
    BB_TEST_AGY_ENV: "launch-env",
    BB_TEST_AGY_OUTPUT: JSON.stringify(response),
  };
});

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true });
});

describe("Antigravity quota collection", () => {
  it("reads structured quota without an agent turn and preserves model groups and resets", async () => {
    expect(
      providerUsageResultSchema.parse(await readAntigravityUsage(command, env)),
    ).toEqual({
      supported: true,
      usage: {
        status: "ok",
        accountKey: null,
        accountEmail: null,
        planLabel: null,
        windows: [
          {
            label: "Gemini Models: Weekly Limit",
            kind: "weekly",
            model: "Gemini Models",
            usedPercent: 37.5,
            resetsAt: "2026-11-28T16:27:36Z",
          },
          {
            label: "Gemini Models: Five Hour Limit",
            kind: "five-hour",
            model: "Gemini Models",
            usedPercent: 100,
            resetsAt: "2026-11-21T21:27:36Z",
          },
          {
            label: "Claude and GPT models: Weekly Limit",
            kind: "weekly",
            model: "Claude and GPT models",
            usedPercent: 0,
            resetsAt: null,
          },
        ],
      },
    });
  });

  it.each([
    "not json",
    JSON.stringify({ status: "ERROR", response: "secret-token" }),
    JSON.stringify({
      ...response,
      command: { name: "other", data: response.command.data },
    }),
    JSON.stringify({
      ...response,
      command: { name: "usage", data: { groups: [] } },
    }),
    JSON.stringify(response).replace(
      '"remaining_fraction":0.625',
      '"remaining_fraction":1.5',
    ),
    JSON.stringify(response).replace("2026-11-28T16:27:36Z", "invalid-date"),
  ])(
    "reports malformed or unsuccessful quota as unavailable: %#",
    async (output) => {
      const result = await readAntigravityUsage(command, {
        ...env,
        BB_TEST_AGY_OUTPUT: output,
      });
      expect(result).toMatchObject({
        supported: true,
        usage: { status: "error" },
      });
      expect(JSON.stringify(result)).not.toContain("secret-token");
    },
  );

  it("does not turn failed commands into zero usage or expose process output", async () => {
    const result = await readAntigravityUsage(command, {
      ...env,
      BB_TEST_AGY_FAIL: "1",
    });
    expect(result).toMatchObject({
      supported: true,
      usage: { status: "error" },
    });
    expect(JSON.stringify(result)).not.toContain("secret-token");
  });

  it("reports a missing CLI without attempting collection", async () => {
    expect(
      await getAcpProviderUsage({
        maintenance: undefined,
        dialectId: "antigravity",
        command: path.join(directory, "missing"),
        env,
      }),
    ).toEqual({ supported: true, usage: { status: "not_installed" } });
  });

  it("routes bridge usage with an explicit dialect and the configured launch environment", async () => {
    const { handleLine } = await import("./bridge.js");
    const output = captureBridgeJsonRpcOutput();
    try {
      handleLine(
        JSON.stringify({
          jsonrpc: "2.0",
          id: "agy-usage",
          method: "provider/usage",
          params: {
            providerId: "custom-antigravity",
            envVars: {},
            providerOptions: {
              acpDialect: "antigravity",
              acpLaunchSpec: {
                displayName: "Antigravity",
                command,
                args: ["acp"],
                env,
              },
            },
          },
        }),
      );
      await vi.waitFor(() =>
        expect(
          output.messages.some((message) => message.id === "agy-usage"),
        ).toBe(true),
      );
      expect(
        providerUsageResultSchema.parse(
          output.messages.find((message) => message.id === "agy-usage")?.result,
        ),
      ).toMatchObject({
        supported: true,
        usage: {
          status: "ok",
          windows: [
            { usedPercent: 37.5 },
            { usedPercent: 100 },
            { usedPercent: 0 },
          ],
        },
      });
    } finally {
      output.restore();
    }
  });
});
