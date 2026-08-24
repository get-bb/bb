import type {
  TerminalListResponse,
  TerminalSession,
} from "@bb/server-contract";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
  terminalSessionQueryKey,
  terminalsQueryKey,
} from "@/lib/query/query-keys";
import {
  applyTerminalSessionClose,
  applyTerminalSessionUpsert,
  terminalScopesForSession,
} from "./terminal-cache";

function session(overrides: Partial<TerminalSession> = {}): TerminalSession {
  return {
    id: "term_1",
    threadId: "thr_1",
    environmentId: "env_1",
    hostId: "host_1",
    title: "zsh",
    initialCwd: "/work",
    cols: 80,
    rows: 24,
    status: "running",
    exitCode: null,
    closeReason: null,
    createdAt: 1,
    updatedAt: 1,
    lastUserInputAt: null,
    ...overrides,
  };
}

function listOf(client: QueryClient, threadId: string) {
  return client.getQueryData<TerminalListResponse>(
    terminalsQueryKey({ kind: "thread", threadId }),
  );
}

describe("terminal session cache", () => {
  it("scopes a session to its thread, else its environment, else both host lists", () => {
    expect(terminalScopesForSession(session())).toEqual([
      { kind: "thread", threadId: "thr_1" },
    ]);
    expect(terminalScopesForSession(session({ threadId: null }))).toEqual([
      { kind: "environment", environmentId: "env_1" },
    ]);
    expect(
      terminalScopesForSession(
        session({ threadId: null, environmentId: null }),
      ),
    ).toEqual([
      { kind: "host_path", hostId: "host_1" },
      { kind: "host_path", hostId: "host_1", cwd: "/work" },
    ]);
  });

  it("upserts into the thread list and the session record without duplicating", () => {
    const client = new QueryClient();
    applyTerminalSessionUpsert(client, session());
    applyTerminalSessionUpsert(client, session({ title: "vim" }));
    applyTerminalSessionUpsert(client, session({ id: "term_2" }));
    expect(
      listOf(client, "thr_1")?.sessions.map((s) => [s.id, s.title]),
    ).toEqual([
      ["term_1", "vim"],
      ["term_2", "zsh"],
    ]);
    expect(
      client.getQueryData<TerminalSession>(terminalSessionQueryKey("term_1"))
        ?.title,
    ).toBe("vim");
  });

  it("drops an exited session from the list but keeps a disconnected one", () => {
    const client = new QueryClient();
    applyTerminalSessionUpsert(client, session());
    applyTerminalSessionUpsert(client, session({ id: "term_2" }));
    applyTerminalSessionClose(client, session({ status: "disconnected" }));
    expect(listOf(client, "thr_1")?.sessions.map((s) => s.status)).toEqual([
      "disconnected",
      "running",
    ]);
    applyTerminalSessionClose(
      client,
      session({ status: "exited", exitCode: 0 }),
    );
    expect(listOf(client, "thr_1")?.sessions.map((s) => s.id)).toEqual([
      "term_2",
    ]);
    // The record survives so an open screen can show "exited".
    expect(
      client.getQueryData<TerminalSession>(terminalSessionQueryKey("term_1"))
        ?.status,
    ).toBe("exited");
  });
});
