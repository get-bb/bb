import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  collectLogPayloads,
  runCommand,
  setupCommandOutputTestEnvironment,
} from "./command-output-harness.js";

describe("command output harness stream cleanup", () => {
  let stdinTty: PropertyDescriptor | undefined;
  let stdoutTty: PropertyDescriptor | undefined;
  const nonTty = {
    value: false,
    configurable: true,
    enumerable: false,
    writable: false,
  };

  beforeEach(() => {
    stdinTty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    stdoutTty = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    Reflect.deleteProperty(process.stdin, "isTTY");
    Object.defineProperty(process.stdout, "isTTY", nonTty);
  });

  afterEach(() => {
    try {
      expect(
        Object.getOwnPropertyDescriptor(process.stdin, "isTTY"),
      ).toBeUndefined();
      expect(Object.getOwnPropertyDescriptor(process.stdout, "isTTY")).toEqual(
        nonTty,
      );
    } finally {
      if (stdinTty === undefined)
        Reflect.deleteProperty(process.stdin, "isTTY");
      else Object.defineProperty(process.stdin, "isTTY", stdinTty);
      if (stdoutTty === undefined)
        Reflect.deleteProperty(process.stdout, "isTTY");
      else Object.defineProperty(process.stdout, "isTTY", stdoutTty);
    }
  });

  describe("command execution", () => {
    setupCommandOutputTestEnvironment();

    it("captures command output and restores original stream descriptors", async () => {
      await runCommand(["echo"], (program) => {
        program.command("echo").action(() => {
          console.log("captured output");
        });
      });
      expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
        "captured output",
      ]);
    });
  });
});
