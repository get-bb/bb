import { describe, expect, it, vi } from "vitest";
import { registerMachineCommands } from "../../commands/machine.js";
import {
  collectLogPayloads,
  runCommand,
  setupCommandOutputTestEnvironment,
} from "../helpers/command-output-harness.js";

describe("machine env commands", () => {
  setupCommandOutputTestEnvironment();
  const result = {
    builtInGit: { status: "overridden", statusMessage: "User override" },
    variables: [{ name: "GH_TOKEN", secret: true, value: null, note: null }],
  };
  const register = (program: import("commander").Command) =>
    registerMachineCommands(program, () => "http://server");
  it("sends a secret from stdin, lists metadata, and unsets through SDK routes", async () => {
    const requests: Request[] = [];
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      requests.push(new Request(input, init));
      return new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json" },
      });
    });
    const stdin = vi
      .spyOn(process.stdin, Symbol.asyncIterator)
      .mockImplementation(async function* () {
        yield Buffer.from("cli-secret\n");
      });
    const wasTty = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", {
      value: false,
      configurable: true,
    });
    try {
      await runCommand(
        ["machine", "env", "set", "GH_TOKEN", "--json"],
        register,
      );
      expect(collectLogPayloads(vi.mocked(console.error))).toEqual([]);
      expect(await requests[0].json()).toEqual({
        name: "GH_TOKEN",
        value: "cli-secret",
        note: null,
      });
      expect(requests[0].method).toBe("PUT");
      await runCommand(["machine", "env", "list", "--json"], register);
      await runCommand(
        ["machine", "env", "unset", "GH_TOKEN", "--json"],
        register,
      );
      expect(requests.map((request) => request.method)).toEqual([
        "PUT",
        "GET",
        "DELETE",
      ]);
      expect(requests[2].url).toBe(
        "http://server/api/v1/settings/machine-environment/GH_TOKEN",
      );
      expect(
        collectLogPayloads(vi.mocked(console.log)).join("\n"),
      ).not.toContain("cli-secret");
    } finally {
      stdin.mockRestore();
      Object.defineProperty(process.stdin, "isTTY", {
        value: wasTty,
        configurable: true,
      });
    }
  });
});
