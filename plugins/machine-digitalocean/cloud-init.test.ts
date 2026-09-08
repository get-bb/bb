import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { cloudInit } from "./cloud-init.js";

describe("cloud-init delivery", () => {
  it("writes bootstrap privately and feeds installer stdin without secret command arguments", () => {
    const data = cloudInit({
      command: ["sh", "-c", "cat >/dev/null"],
      stdin: "credential-secret",
    });
    expect(data).toContain('"permissions":"0600"');
    expect(data).toContain(Buffer.from("credential-secret").toString("base64"));
    expect(data).not.toContain("credential-secret");
    expect(data).toContain("rm -f /run/bb-enrollment.stdin");
    expect(data).toContain("< /run/bb-enrollment.stdin >/dev/null 2>&1");
  });
  it("keeps installer metacharacters quoted and rejects oversized user-data", () => {
    const data = cloudInit({
      command: ["printf", "%s", "it's $(id)"],
      stdin: "",
    });
    expect(data).toContain("$(id)");
    const config = z
      .object({
        runcmd: z.array(z.tuple([z.string(), z.string(), z.string()])),
      })
      .parse(JSON.parse(data.slice("#cloud-config\n".length)));
    execFileSync("sh", ["-n"], { input: config.runcmd[0]?.[2] });
    expect(() =>
      cloudInit({ command: ["true"], stdin: "x".repeat(64 * 1024) }),
    ).toThrow("64 KiB");
  });
});
