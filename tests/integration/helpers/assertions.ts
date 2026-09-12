import fs from "node:fs/promises";
import type {
  Environment,
  EnvironmentStatus,
  Host,
  Thread,
  ThreadEventRow,
  ThreadStatus,
} from "@bb/domain";
import { createPublicApiClient } from "@bb/server-contract";
import {
  previewThreadText,
  stringifyThreadEventData,
  summarizeThreadEventTail,
} from "./thread-diagnostics.js";
import {
  getEnvironment,
  getThread,
  getThreadEvents,
  getThreadOutput,
} from "./api.js";

const POLL_INTERVAL_MS = 100;

type PublicApiClient = ReturnType<typeof createPublicApiClient>;

interface ThreadStatusFailureContext {
  currentStatus: ThreadStatus | "unknown";
  expectedStatus: ThreadStatus;
  threadId: string;
}

async function pollUntil<T>(
  check: () => Promise<T | null>,
  expectation: string,
  timeoutMs: number,
  getCurrentState: () => string,
): Promise<T> {
  const startedAt = Date.now();

  while (Date.now() - startedAt <= timeoutMs) {
    const value = await check();
    if (value) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(`${expectation}. Current state: ${getCurrentState()}`);
}

async function readHost(api: PublicApiClient, hostId: string): Promise<Host> {
  const response = await api.hosts[":id"].$get({
    param: { id: hostId },
  });
  if (response.status !== 200) {
    throw new Error(`Expected host ${hostId} to exist, got ${response.status}`);
  }
  return response.json();
}

async function buildThreadStatusFailureMessage(
  api: PublicApiClient,
  context: ThreadStatusFailureContext,
): Promise<string> {
  const [events, output] = await Promise.all([
    getThreadEvents(api, context.threadId),
    getThreadOutput(api, context.threadId).catch(() => null),
  ]);
  const { lastError, lastTurnCompleted, lastTurnStarted, recentEvents } =
    summarizeThreadEventTail(events, 12);

  return [
    `Thread ${context.threadId} entered ${context.currentStatus} while waiting for ${context.expectedStatus}`,
    `events=${events.length}`,
    `recentEvents=[${recentEvents || "none"}]`,
    `lastError=${stringifyThreadEventData(lastError)}`,
    `lastTurnStarted=${stringifyThreadEventData(lastTurnStarted)}`,
    `lastTurnCompleted=${stringifyThreadEventData(lastTurnCompleted)}`,
    `outputPreview=${JSON.stringify(previewThreadText(output))}`,
  ].join("; ");
}

export async function waitForThreadStatus(
  api: PublicApiClient,
  threadId: string,
  status: ThreadStatus,
  timeoutMs = 10_000,
): Promise<Thread> {
  let currentStatus: ThreadStatus | "unknown" = "unknown";
  try {
    return await pollUntil(
      async () => {
        const thread = await getThread(api, threadId);
        currentStatus = thread.status;
        if (thread.status === "error" && status !== "error") {
          throw new Error(
            await buildThreadStatusFailureMessage(api, {
              currentStatus: thread.status,
              expectedStatus: status,
              threadId,
            }),
          );
        }
        if (thread.status === status) {
          return thread;
        }
        return null;
      },
      `Timed out waiting for thread ${threadId} to reach status ${status}`,
      timeoutMs,
      () => currentStatus,
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith(`Timed out waiting for thread ${threadId}`)
    ) {
      throw new Error(
        await buildThreadStatusFailureMessage(api, {
          currentStatus,
          expectedStatus: status,
          threadId,
        }),
      );
    }
    throw error;
  }
}

export async function waitForThreadOutputContaining(
  api: PublicApiClient,
  threadId: string,
  expectedText: string,
  timeoutMs = 10_000,
): Promise<string> {
  let currentOutput = "";
  return pollUntil(
    async () => {
      const output = await getThreadOutput(api, threadId);
      currentOutput = previewThreadText(output);
      return output?.includes(expectedText) ? output : null;
    },
    `Timed out waiting for thread ${threadId} output to contain ${JSON.stringify(expectedText)}`,
    timeoutMs,
    () => JSON.stringify(currentOutput),
  );
}

export async function waitForEventType(
  api: PublicApiClient,
  threadId: string,
  eventType: string,
  timeoutMs = 10_000,
): Promise<ThreadEventRow> {
  let lastTypes = "none";
  return pollUntil(
    async () => {
      const events = await getThreadEvents(api, threadId);
      lastTypes = events.map((event) => event.type).join(", ") || "none";
      return events.find((event) => event.type === eventType) ?? null;
    },
    `Timed out waiting for event ${eventType} on thread ${threadId}`,
    timeoutMs,
    () => lastTypes,
  );
}

export async function waitForHostConnected(
  api: PublicApiClient,
  timeoutMs = 10_000,
): Promise<Host> {
  let currentHosts = "none";
  return pollUntil(
    async () => {
      const response = await api.hosts.$get({});
      if (response.status !== 200) {
        throw new Error(`Expected hosts list, got ${response.status}`);
      }
      const hosts: Host[] = await response.json();
      currentHosts =
        hosts.map((host) => `${host.id}:${host.status}`).join(", ") || "none";
      return hosts.find((host) => host.status === "connected") ?? null;
    },
    "Timed out waiting for a connected host",
    timeoutMs,
    () => currentHosts,
  );
}

export async function waitForHostDisconnected(
  api: PublicApiClient,
  hostId: string,
  timeoutMs = 10_000,
): Promise<void> {
  let currentStatus = "unknown";
  await pollUntil(
    async () => {
      const host = await readHost(api, hostId);
      currentStatus = host.status;
      return host.status === "disconnected" ? host : null;
    },
    `Timed out waiting for host ${hostId} to disconnect`,
    timeoutMs,
    () => currentStatus,
  );
}

export async function waitForEnvironmentStatus(
  api: PublicApiClient,
  environmentId: string,
  status: EnvironmentStatus,
  timeoutMs = 10_000,
): Promise<Environment> {
  let currentStatus = "unknown";
  return pollUntil(
    async () => {
      const environment = await getEnvironment(api, environmentId);
      currentStatus = environment.status;
      return environment.status === status ? environment : null;
    },
    `Timed out waiting for environment ${environmentId} to reach ${status}`,
    timeoutMs,
    () => currentStatus,
  );
}

export async function waitForPathRemoval(
  pathToCheck: string,
  timeoutMs = 10_000,
): Promise<void> {
  await pollUntil(
    async () => {
      try {
        await fs.access(pathToCheck);
        return null;
      } catch {
        return true;
      }
    },
    `Timed out waiting for ${pathToCheck} to be removed`,
    timeoutMs,
    () => "path still exists",
  );
}
