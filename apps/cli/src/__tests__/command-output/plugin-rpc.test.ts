import { describe, expect, it, vi } from "vitest";
import {
  collectLogPayloads,
  runCommand,
  setupCommandOutputTestEnvironment,
  type CommandRegistrar,
} from "../helpers/command-output-harness.js";
import { registerPluginCommands } from "../../commands/plugin.js";

describe("bb plugin rpc call refusals", () => {
  setupCommandOutputTestEnvironment();
  const register: CommandRegistrar = (program) =>
    registerPluginCommands(program, () => "http://server");

  it.each([
    [false, "forbidden"],
    [true, "forbidden"],
    [false, "future_refusal"],
    [true, "future_refusal"],
  ] as const)(
    "prints the code and message and exits 1 (json=%s, code=%s)",
    async (json, code) => {
      vi.mocked(fetch).mockResolvedValueOnce(
        Response.json(
          {
            ok: false,
            error: { code, message: "Only connect may call" },
          },
          { status: 403 },
        ),
      );
      await expect(
        runCommand(
          [
            "plugin",
            "rpc",
            "call",
            "private",
            "write",
            ...(json ? ["--json"] : []),
          ],
          register,
        ),
      ).rejects.toThrow("process.exit:1");
      expect(console.error).toHaveBeenCalledWith(
        `Error: ${code}: HTTP 403: Only connect may call`,
      );
      if (json) {
        const [payload] = collectLogPayloads(vi.mocked(console.log));
        expect(JSON.parse(payload ?? "")).toMatchObject({
          ok: false,
          error: {
            code,
            message: `${code}: HTTP 403: Only connect may call`,
          },
        });
      }
    },
  );
});
