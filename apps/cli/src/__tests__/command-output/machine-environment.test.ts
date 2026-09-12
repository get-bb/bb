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
      expect(await requests[1].json()).toEqual({
        variables: [{ name: "GH_TOKEN", value: "cli-secret", note: null }],
      });
      expect(requests[1].method).toBe("PUT");
      await runCommand(["machine", "env", "list", "--json"], register);
      await runCommand(
        ["machine", "env", "unset", "GH_TOKEN", "--json"],
        register,
      );
      expect(requests.map((request) => request.method)).toEqual([
        "GET",
        "PUT",
        "GET",
        "GET",
        "PUT",
      ]);
      expect(await requests[4].json()).toEqual({ variables: [] });
      expect(requests[4].url).toBe(
        "http://server/api/v1/settings/machine-environment",
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
  it.each([
    ["split UTF-8", "café € 🌍\n", "café € 🌍"],
    ["empty input", "", ""],
    ["CRLF", "value\r\n", "value"],
    ["one final newline", "value\n\n", "value\n"],
    ["ASCII byte limit", "a".repeat(65536), "a".repeat(65536)],
    ["UTF-8 byte limit", "é".repeat(32768), "é".repeat(32768)],
    ["over byte limit", "é".repeat(32768) + "a", null],
    ["limit before newline removal", "a".repeat(65536) + "\n", null],
  ] as const)(
    "preserves stdin semantics: %s",
    async (_label, input, expected) => {
      const requests: Request[] = [];
      vi.mocked(fetch).mockImplementation(async (url, init) => {
        requests.push(new Request(url, init));
        return Response.json(result);
      });
      const bytes = Buffer.from(input);
      vi.spyOn(process.stdin, Symbol.asyncIterator).mockImplementation(
        async function* () {
          const start = Math.max(0, bytes.length - 16);
          yield bytes.subarray(0, start);
          for (let i = start; i < bytes.length; i++)
            yield bytes.subarray(i, i + 1);
        },
      );
      const descriptor = Object.getOwnPropertyDescriptor(
        process.stdin,
        "isTTY",
      )!;
      Object.defineProperty(process.stdin, "isTTY", { value: false });
      try {
        const run = runCommand(
          ["machine", "env", "set", "VALUE", "--json"],
          register,
        );
        if (expected === null) {
          await expect(run).rejects.toThrow("process.exit:1");
          expect(requests.map((request) => request.method)).toEqual(["GET"]);
          expect(collectLogPayloads(vi.mocked(console.error))).toContain(
            "Error: Environment value exceeds 65536 bytes.",
          );
        } else {
          await run;
          expect(await requests[1].json()).toEqual({
            variables: [
              { name: "GH_TOKEN", value: null, note: null },
              { name: "VALUE", value: expected, note: null },
            ],
          });
          expect(requests[1].method).toBe("PUT");
        }
      } finally {
        Object.defineProperty(process.stdin, "isTTY", descriptor);
      }
    },
  );
});
