import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";

const enrollKeySchema = z.object({
  enrollKey: z.string().min(1),
  hostId: z.string().min(1),
});

const hostListSchema = z.array(
  z.object({ id: z.string().min(1), status: z.string() }),
);

const idSchema = z.object({ id: z.string().min(1) });

const threadSchema = z.object({
  id: z.string().min(1),
  status: z.string(),
});

const eventRowSchema = z.object({ seq: z.number() });

function textInput(text: string) {
  return [{ mentions: [], text, type: "text" as const }];
}

export class BenchApi {
  private readonly serverUrl: string;

  constructor(serverUrl: string) {
    this.serverUrl = serverUrl;
  }

  private async request(
    path: string,
    description: string,
    body?: unknown,
  ): Promise<Response> {
    const response = await fetch(
      `${this.serverUrl}${path}`,
      body === undefined
        ? {}
        : {
            body: JSON.stringify(body),
            headers: { "content-type": "application/json" },
            method: "POST",
          },
    );
    if (!response.ok) {
      throw new Error(
        `${description} failed: ${response.status} ${await response.text()}`,
      );
    }
    return response;
  }

  async createEnrollKey(): Promise<z.infer<typeof enrollKeySchema>> {
    const response = await this.request(
      "/internal/hosts/enroll-key",
      "create host enroll key",
      {},
    );
    return enrollKeySchema.parse(await response.json());
  }

  async createProject(args: {
    hostId: string;
    name: string;
    path: string;
  }): Promise<string> {
    const response = await this.request("/api/v1/projects", "create project", {
      name: args.name,
      source: { hostId: args.hostId, path: args.path, type: "local_path" },
    });
    return idSchema.parse(await response.json()).id;
  }

  async installPlugin(source: string): Promise<void> {
    await this.request("/api/v1/plugins/install", `install plugin ${source}`, {
      source,
    });
  }

  async isReady(): Promise<boolean> {
    return fetch(`${this.serverUrl}/api/v1/system/config`).then(
      (response) => response.ok,
      () => false,
    );
  }

  async listConnectedHostIds(): Promise<string[]> {
    const response = await fetch(`${this.serverUrl}/api/v1/hosts`);
    if (!response.ok) {
      return [];
    }
    return hostListSchema
      .parse(await response.json())
      .filter((host) => host.status === "connected")
      .map((host) => host.id);
  }

  async spawnThread(args: {
    hostId: string;
    model: string;
    projectId: string;
    prompt: string;
    providerId: string;
    title: string;
  }): Promise<string> {
    const response = await this.request("/api/v1/threads", "spawn thread", {
      environment: {
        hostId: args.hostId,
        type: "host",
        workspace: { path: null, type: "unmanaged" },
      },
      input: textInput(args.prompt),
      model: args.model,
      origin: "app",
      originKind: null,
      permissionMode: "full",
      projectId: args.projectId,
      providerId: args.providerId,
      startedOnBehalfOf: null,
      title: args.title,
    });
    return threadSchema.parse(await response.json()).id;
  }

  async runTurn(
    threadId: string,
    text: string,
    timeoutMs: number,
  ): Promise<void> {
    const latest = await this.request(
      `/api/v1/threads/${threadId}/events?order=desc&limit=1`,
      `latest event of ${threadId}`,
    );
    const afterSeq =
      z.array(eventRowSchema).parse(await latest.json())[0]?.seq ?? 0;
    await this.request(
      `/api/v1/threads/${threadId}/send`,
      `send to ${threadId}`,
      {
        input: textInput(text),
        mode: "auto",
      },
    );
    await this.waitForEvent(threadId, "turn/completed", afterSeq, timeoutMs);
    await this.waitForThreadStatus(threadId, "idle", timeoutMs);
  }

  async waitForThreadStatus(
    threadId: string,
    status: string,
    timeoutMs: number,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let last = "unknown";
    while (Date.now() < deadline) {
      const response = await this.request(
        `/api/v1/threads/${threadId}`,
        `get thread ${threadId}`,
      );
      last = threadSchema.parse(await response.json()).status;
      if (last === status) {
        return;
      }
      if (last === "error") {
        throw new Error(`Thread ${threadId} entered error status`);
      }
      await sleep(100);
    }
    throw new Error(
      `Timed out waiting for ${threadId} to reach ${status} (last ${last})`,
    );
  }

  private async waitForEvent(
    threadId: string,
    type: string,
    afterSeq: number,
    timeoutMs: number,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const waitMs = Math.min(60_000, Math.max(1_000, deadline - Date.now()));
      const response = await this.request(
        `/api/v1/threads/${threadId}/events/wait?type=${encodeURIComponent(type)}&afterSeq=${afterSeq}&waitMs=${waitMs}`,
        `wait for ${type} on ${threadId}`,
      );
      if (response.status !== 204) {
        eventRowSchema.parse(await response.json());
        return;
      }
    }
    throw new Error(
      `Timed out waiting for ${type} after ${afterSeq} on ${threadId}`,
    );
  }
}

export async function waitUntil<T>(
  check: () => Promise<T | null>,
  description: string,
  timeoutMs: number,
  intervalMs = 200,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await check();
    if (result !== null) {
      return result;
    }
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for ${description}`);
}
