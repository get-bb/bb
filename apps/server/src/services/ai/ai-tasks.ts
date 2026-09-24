import { getAiServiceSelections } from "@bb/db";
import type {
  AiServiceSelection,
  AiServiceStatus,
  AiTask,
  AiTextTask,
  JsonObject,
} from "@bb/domain";
import type { LoggedWorkSessionDeps } from "../../types.js";
import { runtimeErrorLogFields } from "../lib/error-log-fields.js";
import { AUTOMATIC_AI_SERVICE_PLUGIN_IDS } from "../plugins/builtin-registry.js";
import { cleanGeneratedLine } from "./ai-reply.js";
import {
  aiServiceKey,
  aiServiceSupportsTask,
  type AiServiceRegistration,
} from "./ai-service-registry.js";

export const AI_TASK_TIMEOUT_MS: Record<AiTask, number> = {
  "thread-title": 5_000,
  "commit-message": 5_000,
  voice: 10_000,
};

export type AiTaskFailureReason =
  | "off"
  | "unavailable"
  | "timeout"
  | "failed"
  | "cancelled";

export type AiTaskOutcome<T> =
  | {
      ok: true;
      value: T;
      service: AiServiceRegistration;
      durationMs: number;
    }
  | {
      ok: false;
      reason: AiTaskFailureReason;
      message: string;
      durationMs: number;
    };

type AiTaskDeps = Pick<
  LoggedWorkSessionDeps,
  "aiServices" | "config" | "db" | "logger"
>;

interface RunAiTaskArgs<T> {
  task: AiTask;
  label: string;
  logContext?: JsonObject;
  timeoutMs?: number;
  signal?: AbortSignal;
  call: (service: AiServiceRegistration, signal: AbortSignal) => Promise<T>;
  accept: (value: T) => T | null;
}

const REQUEST_CANCELLED_MESSAGE = "The request was cancelled";

class AiTaskTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Timed out after ${timeoutMs}ms`);
    this.name = "AiTaskTimeoutError";
  }
}

export function automaticAiServices(
  deps: Pick<AiTaskDeps, "aiServices">,
  task: AiTask,
): AiServiceRegistration[] {
  const services = deps.aiServices.list();
  return AUTOMATIC_AI_SERVICE_PLUGIN_IDS.flatMap((pluginId) =>
    services.filter(
      (service) =>
        service.builtin &&
        service.pluginId === pluginId &&
        aiServiceSupportsTask(service, task),
    ),
  );
}

export function automaticAiServiceRank(
  service: AiServiceRegistration,
): number | null {
  if (!service.builtin) return null;
  const rank = AUTOMATIC_AI_SERVICE_PLUGIN_IDS.indexOf(service.pluginId);
  return rank === -1 ? null : rank;
}

export function selectedAiService(
  deps: Pick<AiTaskDeps, "aiServices">,
  task: AiTask,
  selection: Extract<AiServiceSelection, { mode: "service" }>,
): AiServiceRegistration | null {
  const service = deps.aiServices.get(selection);
  return service !== null && aiServiceSupportsTask(service, task)
    ? service
    : null;
}

export function aiTaskServices(
  deps: Pick<AiTaskDeps, "aiServices">,
  task: AiTask,
  selection: AiServiceSelection,
): AiServiceRegistration[] {
  if (selection.mode === "off") return [];
  if (selection.mode === "automatic") return automaticAiServices(deps, task);
  const service = selectedAiService(deps, task, selection);
  return service === null ? [] : [service];
}

export function isAiTaskAvailable(
  deps: Pick<AiTaskDeps, "aiServices" | "db">,
  task: AiTask,
): boolean {
  const selection = getAiServiceSelections(deps.db)[task];
  return aiTaskServices(deps, task, selection).some(
    (service) =>
      deps.aiServices.peekStatus(aiServiceKey(service))?.ready === true,
  );
}

function linkedSignal(
  timeoutMs: number,
  parent: AbortSignal | undefined,
): { signal: AbortSignal; dispose(): void; timedOut(): boolean } {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new AiTaskTimeoutError(timeoutMs));
  }, timeoutMs);
  timer.unref();
  const onParentAbort = (): void => controller.abort(parent?.reason);
  if (parent?.aborted) onParentAbort();
  else parent?.addEventListener("abort", onParentAbort, { once: true });
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose() {
      clearTimeout(timer);
      parent?.removeEventListener("abort", onParentAbort);
    },
  };
}

function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function skipMessage(
  service: AiServiceRegistration,
  status: AiServiceStatus,
): string | null {
  return status.ready ? null : `${service.displayName}: ${status.message}`;
}

export async function runAiTask<T>(
  deps: AiTaskDeps,
  args: RunAiTaskArgs<T>,
): Promise<AiTaskOutcome<T>> {
  const startedAt = Date.now();
  const selection = getAiServiceSelections(deps.db)[args.task];
  const fail = (
    reason: AiTaskFailureReason,
    message: string,
  ): AiTaskOutcome<T> => ({
    ok: false,
    reason,
    message,
    durationMs: Date.now() - startedAt,
  });
  if (selection.mode === "off") {
    return fail("off", "Turned off in Settings → AI services");
  }
  if (args.signal?.aborted) {
    return fail("cancelled", REQUEST_CANCELLED_MESSAGE);
  }
  const services = aiTaskServices(deps, args.task, selection);
  if (services.length === 0) {
    return fail(
      "unavailable",
      selection.mode === "service"
        ? `The selected AI service "${selection.serviceId}" is not loaded`
        : "No AI service is available",
    );
  }
  const timeoutMs = args.timeoutMs ?? AI_TASK_TIMEOUT_MS[args.task];
  let last: { reason: AiTaskFailureReason; message: string } = {
    reason: "unavailable",
    message: "No AI service is ready",
  };
  for (const service of services) {
    const skipped = skipMessage(
      service,
      await deps.aiServices.status(aiServiceKey(service)),
    );
    if (skipped !== null) {
      last = { reason: "unavailable", message: skipped };
      continue;
    }
    if (args.signal?.aborted) {
      last = { reason: "cancelled", message: REQUEST_CANCELLED_MESSAGE };
      break;
    }
    const link = linkedSignal(timeoutMs, args.signal);
    const fields = {
      task: args.task,
      serviceId: service.id,
      pluginId: service.pluginId,
      ...args.logContext,
    };
    try {
      const raw = await abortable(
        Promise.resolve().then(() => args.call(service, link.signal)),
        link.signal,
      );
      const value = args.accept(raw);
      if (value !== null) {
        return {
          ok: true,
          value,
          service,
          durationMs: Date.now() - startedAt,
        };
      }
      last = {
        reason: "failed",
        message: `${service.displayName} returned an empty reply`,
      };
      deps.logger.warn(fields, `${args.label} returned an empty reply`);
    } catch (error) {
      if (args.signal?.aborted) {
        last = { reason: "cancelled", message: REQUEST_CANCELLED_MESSAGE };
        deps.logger.info(fields, `${args.label} was cancelled`);
        break;
      }
      if (link.timedOut()) {
        last = {
          reason: "timeout",
          message: `${service.displayName} timed out after ${timeoutMs}ms`,
        };
        deps.logger.info({ ...fields, timeoutMs }, `${args.label} timed out`);
      } else {
        const message =
          error instanceof Error && error.message.trim().length > 0
            ? error.message.trim()
            : "Request failed";
        last = {
          reason: "failed",
          message: `${service.displayName}: ${message}`,
        };
        deps.logger.warn(
          { ...fields, ...runtimeErrorLogFields(deps.config, error) },
          `${args.label} failed`,
        );
      }
    } finally {
      link.dispose();
    }
  }
  return fail(last.reason, last.message);
}

export function runTextAiTask(
  deps: AiTaskDeps,
  args: {
    task: AiTextTask;
    label: string;
    prompt: string;
    logContext?: JsonObject;
    timeoutMs?: number;
    signal?: AbortSignal;
  },
): Promise<AiTaskOutcome<string>> {
  return runAiTask(deps, {
    task: args.task,
    label: args.label,
    ...(args.logContext === undefined ? {} : { logContext: args.logContext }),
    ...(args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs }),
    ...(args.signal === undefined ? {} : { signal: args.signal }),
    call: (service, signal) => {
      if (service.complete === null) {
        throw new Error("This service does not answer text prompts");
      }
      return service.complete(args.prompt, { signal });
    },
    accept: (raw) => (typeof raw === "string" ? cleanGeneratedLine(raw) : null),
  });
}
