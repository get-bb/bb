import { QueryClient } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { makeTerminalSession } from "@/test/fixtures/terminal-sessions";
import {
  parkTerminalRuntime,
  takeParkedTerminalRuntime,
} from "@/lib/terminal-runtime-cache";
import {
  applyTerminalSessionClose,
  applyTerminalSessionMissing,
} from "./terminal-cache-owner";

afterEach(() => {
  takeParkedTerminalRuntime("term_test");
});

it("evicts the parked runtime when a terminal closes as exited", () => {
  const runtime = { dispose: vi.fn() };
  parkTerminalRuntime("term_test", runtime);
  applyTerminalSessionClose({
    queryClient: new QueryClient(),
    session: makeTerminalSession({ status: "disconnected" }),
    terminalId: "term_test",
  });
  expect(runtime.dispose).not.toHaveBeenCalled();
  applyTerminalSessionClose({
    queryClient: new QueryClient(),
    session: makeTerminalSession({ status: "exited" }),
    terminalId: "term_test",
  });
  expect(runtime.dispose).toHaveBeenCalledTimes(1);
  expect(takeParkedTerminalRuntime("term_test")).toBeNull();
});

it("evicts the parked runtime when a terminal is missing", () => {
  const runtime = { dispose: vi.fn() };
  parkTerminalRuntime("term_test", runtime);
  applyTerminalSessionMissing({
    queryClient: new QueryClient(),
    terminalId: "term_test",
  });
  expect(runtime.dispose).toHaveBeenCalledTimes(1);
  expect(takeParkedTerminalRuntime("term_test")).toBeNull();
});
