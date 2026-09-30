import {
  aiServiceStatusSchema,
  type AiServiceStatus,
  type AiTask,
} from "@bb/domain";
import type { NormalizedPluginAiService } from "@get-bb/plugin-sdk/internal/host-policy";
import { aiServiceAlreadyRegisteredMessage } from "@get-bb/plugin-sdk/internal/host-policy";

const STATUS_TTL_MS = 10_000;
const STATUS_TIMEOUT_MS = 2_000;
const NOT_RESPONDING: AiServiceStatus = {
  ready: false,
  message: "Not responding",
};

export interface AiServiceRegistration extends NormalizedPluginAiService {
  pluginId: string;
  builtin: boolean;
}

export interface AiServiceInfo {
  id: string;
  displayName: string;
  pluginId: string;
  builtin: boolean;
  tasks: AiTask[];
}

export interface AiServiceKey {
  pluginId: string;
  serviceId: string;
}

interface CachedStatus {
  status: AiServiceStatus;
  checkedAt: number;
}

export interface AiServiceRegistry {
  register(registration: AiServiceRegistration): { dispose(): void };
  get(key: AiServiceKey): AiServiceRegistration | null;
  list(): AiServiceRegistration[];
  peekStatus(key: AiServiceKey): AiServiceStatus | null;
  status(key: AiServiceKey): Promise<AiServiceStatus>;
}

interface CreateAiServiceRegistryArgs {
  onStatusChange?: () => void;
  now?: () => number;
}

export function aiServiceTasks(service: NormalizedPluginAiService): AiTask[] {
  return [
    ...(service.complete === null
      ? []
      : (["thread-title", "commit-message"] as const)),
    ...(service.transcribe === null ? [] : (["voice"] as const)),
  ];
}

export function aiServiceSupportsTask(
  service: NormalizedPluginAiService,
  task: AiTask,
): boolean {
  return task === "voice"
    ? service.transcribe !== null
    : service.complete !== null;
}

export function aiServiceKey(service: AiServiceRegistration): AiServiceKey {
  return { pluginId: service.pluginId, serviceId: service.id };
}

function mapKey(key: AiServiceKey): string {
  return `${key.pluginId}/${key.serviceId}`;
}

export function toAiServiceInfo(service: AiServiceRegistration): AiServiceInfo {
  return {
    id: service.id,
    displayName: service.displayName,
    pluginId: service.pluginId,
    builtin: service.builtin,
    tasks: aiServiceTasks(service),
  };
}

async function readStatus(
  service: AiServiceRegistration,
): Promise<AiServiceStatus> {
  if (service.status === null) return { ready: true };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const raw = await Promise.race([
      service.status(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), STATUS_TIMEOUT_MS);
        timer.unref();
      }),
    ]);
    if (raw === null) return NOT_RESPONDING;
    const parsed = aiServiceStatusSchema.safeParse(raw);
    return parsed.success
      ? parsed.data
      : { ready: false, message: "Reported an invalid status" };
  } catch (error) {
    const message = error instanceof Error ? error.message.trim() : "";
    return {
      ready: false,
      message: message.length > 0 ? message : "Status check failed",
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function createAiServiceRegistry(
  args: CreateAiServiceRegistryArgs = {},
): AiServiceRegistry {
  const now = args.now ?? Date.now;
  const services = new Map<string, AiServiceRegistration>();
  const statuses = new Map<AiServiceRegistration, CachedStatus>();
  const inFlight = new Map<AiServiceRegistration, Promise<AiServiceStatus>>();

  function refresh(service: AiServiceRegistration): Promise<AiServiceStatus> {
    const pending = inFlight.get(service);
    if (pending !== undefined) return pending;
    const request = readStatus(service)
      .then((status) => {
        const previous = statuses.get(service)?.status;
        if (services.get(mapKey(aiServiceKey(service))) === service) {
          statuses.set(service, { status, checkedAt: now() });
        }
        if (previous === undefined || previous.ready !== status.ready) {
          args.onStatusChange?.();
        }
        return status;
      })
      .finally(() => inFlight.delete(service));
    inFlight.set(service, request);
    return request;
  }

  return {
    register(registration) {
      const key = mapKey(aiServiceKey(registration));
      if (services.has(key)) {
        throw new Error(aiServiceAlreadyRegisteredMessage(registration.id));
      }
      services.set(key, registration);
      args.onStatusChange?.();
      let disposed = false;
      return {
        dispose() {
          if (disposed) return;
          disposed = true;
          if (services.get(key) === registration) {
            services.delete(key);
            statuses.delete(registration);
            args.onStatusChange?.();
          }
        },
      };
    },
    get(key) {
      return services.get(mapKey(key)) ?? null;
    },
    list() {
      return [...services.values()];
    },
    peekStatus(key) {
      const service = services.get(mapKey(key));
      if (service === undefined) return null;
      const cached = statuses.get(service);
      if (cached === undefined || now() - cached.checkedAt > STATUS_TTL_MS) {
        void refresh(service);
      }
      return cached?.status ?? null;
    },
    async status(key) {
      const service = services.get(mapKey(key));
      if (service === undefined) {
        return { ready: false, message: "Plugin not loaded" };
      }
      const cached = statuses.get(service);
      if (cached !== undefined && now() - cached.checkedAt <= STATUS_TTL_MS) {
        return cached.status;
      }
      return refresh(service);
    },
  };
}
