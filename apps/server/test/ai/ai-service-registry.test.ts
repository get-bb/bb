import { describe, expect, it, vi } from "vitest";
import {
  createAiServiceRegistry,
  type AiServiceRegistration,
} from "../../src/services/ai/ai-service-registry.js";

const ACME = { pluginId: "acme-plugin", serviceId: "acme" };

function service(
  status: AiServiceRegistration["status"],
  id = "acme",
  pluginId = "acme-plugin",
): AiServiceRegistration {
  return {
    id,
    displayName: "Acme",
    pluginId,
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

    expect(registry.peekStatus(ACME)).toBeNull();
    await expect(registry.status(ACME)).resolves.toEqual({ ready: true });
    await registry.status(ACME);
    expect(status).toHaveBeenCalledTimes(1);

    clock += 10_001;
    await registry.status(ACME);
    expect(status).toHaveBeenCalledTimes(2);
  });

  it("keeps services with the same id from different plugins apart", async () => {
    const registry = createAiServiceRegistry();
    registry.register(service(null));
    registry.register(
      service(
        async () => ({ ready: false, message: "Other plugin" }),
        "acme",
        "other-plugin",
      ),
    );

    expect(registry.list().map((entry) => entry.pluginId)).toEqual([
      "acme-plugin",
      "other-plugin",
    ]);
    expect(registry.get(ACME)?.pluginId).toBe("acme-plugin");
    await expect(registry.status(ACME)).resolves.toEqual({ ready: true });
    await expect(
      registry.status({ pluginId: "other-plugin", serviceId: "acme" }),
    ).resolves.toEqual({ ready: false, message: "Other plugin" });
    expect(() => registry.register(service(null))).toThrow(
      'AI service "acme" is already registered by this plugin.',
    );
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

    await expect(registry.status(ACME)).resolves.toEqual({
      ready: false,
      message: "Sign in first",
    });
    await expect(
      registry.status({ pluginId: "acme-plugin", serviceId: "broken" }),
    ).resolves.toEqual({
      ready: false,
      message: "Reported an invalid status",
    });
  });

  it("treats a service without a status function as always ready", async () => {
    const registry = createAiServiceRegistry();
    registry.register(service(null));
    await expect(registry.status(ACME)).resolves.toEqual({ ready: true });
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

    await registry.status(ACME);
    expect(onStatusChange).toHaveBeenCalledTimes(2);
    clock += 20_000;
    await registry.status(ACME);
    expect(onStatusChange).toHaveBeenCalledTimes(2);

    ready = true;
    clock += 20_000;
    await registry.status(ACME);
    expect(onStatusChange).toHaveBeenCalledTimes(3);

    registration.dispose();
    expect(onStatusChange).toHaveBeenCalledTimes(4);
    expect(registry.get(ACME)).toBeNull();
  });
});
