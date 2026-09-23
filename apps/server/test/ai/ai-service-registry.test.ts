import { describe, expect, it, vi } from "vitest";
import {
  createAiServiceRegistry,
  type AiServiceRegistration,
} from "../../src/services/ai/ai-service-registry.js";

function service(
  status: AiServiceRegistration["status"],
  id = "acme",
): AiServiceRegistration {
  return {
    id,
    displayName: "Acme",
    pluginId: "acme-plugin",
    builtin: false,
    complete: async () => "reply",
    transcribe: null,
    status,
  };
}

describe("AI service registry", () => {
  it("caches status for ten seconds and refreshes after", async () => {
    let clock = 1_000;
    const status = vi.fn(async () => ({ ready: true as const }));
    const registry = createAiServiceRegistry({ now: () => clock });
    registry.register(service(status));

    expect(registry.peekStatus("acme")).toBeNull();
    await expect(registry.status("acme")).resolves.toEqual({ ready: true });
    await registry.status("acme");
    expect(status).toHaveBeenCalledTimes(1);

    clock += 10_001;
    await registry.status("acme");
    expect(status).toHaveBeenCalledTimes(2);
  });

  it("reports a throwing or invalid status as not ready", async () => {
    const registry = createAiServiceRegistry();
    registry.register(
      service(async () => {
        throw new Error("Sign in first");
      }),
    );
    registry.register(
      service(
        // @ts-expect-error — plugin code is untyped at runtime.
        async () => ({ ready: "yes" }),
        "broken",
      ),
    );

    await expect(registry.status("acme")).resolves.toEqual({
      ready: false,
      message: "Sign in first",
    });
    await expect(registry.status("broken")).resolves.toEqual({
      ready: false,
      message: "Reported an invalid status",
    });
  });

  it("treats a service without a status function as always ready", async () => {
    const registry = createAiServiceRegistry();
    registry.register(service(null));
    await expect(registry.status("acme")).resolves.toEqual({ ready: true });
  });

  it("notifies when readiness changes and when services come and go", async () => {
    const onStatusChange = vi.fn();
    let ready = false;
    let clock = 0;
    const registry = createAiServiceRegistry({
      onStatusChange,
      now: () => clock,
    });
    const registration = registry.register(
      service(async () =>
        ready ? { ready: true } : { ready: false, message: "Signed out" },
      ),
    );
    expect(onStatusChange).toHaveBeenCalledTimes(1);

    await registry.status("acme");
    expect(onStatusChange).toHaveBeenCalledTimes(2);
    clock += 20_000;
    await registry.status("acme");
    expect(onStatusChange).toHaveBeenCalledTimes(2);

    ready = true;
    clock += 20_000;
    await registry.status("acme");
    expect(onStatusChange).toHaveBeenCalledTimes(3);

    registration.dispose();
    expect(onStatusChange).toHaveBeenCalledTimes(4);
    expect(registry.get("acme")).toBeNull();
  });
});
