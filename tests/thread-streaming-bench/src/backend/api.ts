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
  projectId: z.string().min(1),
  status: z.string(),
});

export type BenchThread = z.infer<typeof threadSchema>;

const eventRowSchema = z.object({ seq: z.number(), type: z.string() });

async function readJson<T>(
  response: Response,
  schema: z.ZodType<T>,
  description: string,
): Promise<T> {
  if (!response.ok) {
    throw new Error(
      `${description} failed: ${response.status} ${await response.text()}`,
    );
  }
  return schema.parse(await response.json());
}

function jsonRequest(method: string, body: unknown): RequestInit {
  return {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method,
  };
}

function textInput(text: string) {
  return [{ mentions: [], text, type: "text" as const }];
}

export interface BenchApi {
  createEnrollKey(): Promise<z.infer<typeof enrollKeySchema>>;
  createProject(args: {
    hostId: string;
    name: string;
    path: string;
  }): Promise<string>;
  getThread(threadId: string): Promise<BenchThread>;
  installPlugin(source: string): Promise<void>;
  isReady(): Promise<boolean>;
  latestEventSeq(threadId: string): Promise<number>;
  listConnectedHostIds(): Promise<string[]>;
  runTurn(threadId: string, text: string, timeoutMs: number): Promise<void>;
  waitForEvent(
    threadId: string,
    type: string,
    afterSeq: number,
    timeoutMs: number,
  ): Promise<number>;
  sendPrompt(threadId: string, text: string): Promise<void>;
  spawnThread(args: {
    hostId: string;
    model: string;
    projectId: string;
    prompt: string;
    providerId: string;
    title: string;
  }): Promise<BenchThread>;
  waitForThreadStatus(
    threadId: string,
    status: string,
    timeoutMs: number,
  ): Promise<BenchThread>;
}

export function createBenchApi(serverUrl: string): BenchApi {
  const url = (path: string) => `${serverUrl}${path}`;
  const api: BenchApi = {
    async createEnrollKey() {
      return readJson(
        await fetch(url("/internal/hosts/enroll-key"), jsonRequest("POST", {})),
        enrollKeySchema,
        "create host enroll key",
      );
    },
    async createProject({ hostId, name, path }) {
      const project = await readJson(
        await fetch(
          url("/api/v1/projects"),
          jsonRequest("POST", {
            name,
            source: { hostId, path, type: "local_path" },
          }),
        ),
        idSchema,
        "create project",
      );
      return project.id;
    },
    async getThread(threadId) {
      return readJson(
        await fetch(url(`/api/v1/threads/${threadId}`)),
        threadSchema,
        `get thread ${threadId}`,
      );
    },
    async installPlugin(source) {
      const response = await fetch(
        url("/api/v1/plugins/install"),
        jsonRequest("POST", { source }),
      );
      if (!response.ok) {
        throw new Error(
          `install plugin ${source} failed: ${response.status} ${await response.text()}`,
        );
      }
    },
    async isReady() {
      try {
        const response = await fetch(url("/api/v1/system/config"));
        return response.ok;
      } catch {
        return false;
      }
    },
    async latestEventSeq(threadId) {
      const rows = await readJson(
        await fetch(
          url(`/api/v1/threads/${threadId}/events?order=desc&limit=1`),
        ),
        z.array(eventRowSchema),
        `latest event of ${threadId}`,
      );
      return rows[0]?.seq ?? 0;
    },
    async runTurn(threadId, text, timeoutMs) {
      const afterSeq = await api.latestEventSeq(threadId);
      await api.sendPrompt(threadId, text);
      await api.waitForEvent(threadId, "turn/completed", afterSeq, timeoutMs);
      await api.waitForThreadStatus(threadId, "idle", timeoutMs);
    },
    async waitForEvent(threadId, type, afterSeq, timeoutMs) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const waitMs = Math.min(60_000, Math.max(1_000, deadline - Date.now()));
        const response = await fetch(
          url(
            `/api/v1/threads/${threadId}/events/wait?type=${encodeURIComponent(type)}&afterSeq=${afterSeq}&waitMs=${waitMs}`,
          ),
        );
        if (response.status === 204) {
          continue;
        }
        const row = await readJson(
          response,
          eventRowSchema,
          `wait for ${type} on ${threadId}`,
        );
        return row.seq;
      }
      throw new Error(
        `Timed out waiting for ${type} after ${afterSeq} on ${threadId}`,
      );
    },
    async listConnectedHostIds() {
      const response = await fetch(url("/api/v1/hosts"));
      if (!response.ok) {
        return [];
      }
      const hosts = hostListSchema.parse(await response.json());
      return hosts
        .filter((host) => host.status === "connected")
        .map((host) => host.id);
    },
    async sendPrompt(threadId, text) {
      const response = await fetch(
        url(`/api/v1/threads/${threadId}/send`),
        jsonRequest("POST", { input: textInput(text), mode: "auto" }),
      );
      if (!response.ok) {
        throw new Error(
          `send to ${threadId} failed: ${response.status} ${await response.text()}`,
        );
      }
    },
    async spawnThread({ hostId, model, projectId, prompt, providerId, title }) {
      return readJson(
        await fetch(
          url("/api/v1/threads"),
          jsonRequest("POST", {
            environment: {
              hostId,
              type: "host",
              workspace: { path: null, type: "unmanaged" },
            },
            input: textInput(prompt),
            model,
            origin: "app",
            originKind: null,
            permissionMode: "full",
            projectId,
            providerId,
            startedOnBehalfOf: null,
            title,
          }),
        ),
        threadSchema,
        "spawn thread",
      );
    },
    async waitForThreadStatus(threadId, status, timeoutMs) {
      const deadline = Date.now() + timeoutMs;
      let last: BenchThread | null = null;
      while (Date.now() < deadline) {
        last = await api.getThread(threadId);
        if (last.status === status) {
          return last;
        }
        if (last.status === "error") {
          throw new Error(`Thread ${threadId} entered error status`);
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error(
        `Timed out waiting for ${threadId} to reach ${status} (last ${last?.status ?? "unknown"})`,
      );
    },
  };
  return api;
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
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out waiting for ${description}`);
}
