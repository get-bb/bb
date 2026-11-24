import type { AppDeps } from "../../types.js";
import { resolveHostEnvironment } from "./host-environment.js";

const RECHECK_INTERVAL_MS = 60_000;
const syncsByHub = new WeakMap<object, HostEnvironmentSync>();

export async function recheckHostEnvironment(
  deps: Pick<AppDeps, "hub">,
  hostId: string,
): Promise<void> {
  await syncsByHub.get(deps.hub)?.recheck(hostId);
}

export class HostEnvironmentSync {
  private revision = 0;
  private readonly pending = new Map<string, number>();
  private readonly sentEntriesByHostId = new Map<string, string>();
  private readonly checkedAtByHostId = new Map<string, number>();

  constructor(
    private readonly deps: Pick<AppDeps, "db" | "hub"> & {
      config: Pick<AppDeps["config"], "dataDir">;
      logger: Pick<AppDeps["logger"], "warn">;
    },
    private readonly onEnvironmentChanged: (hostId: string) => void,
  ) {
    syncsByHub.set(deps.hub, this);
    deps.hub.onChangedMessage((message) => {
      if (
        message.entity === "system" &&
        message.changes.includes("config-changed")
      ) {
        for (const hostId of deps.hub.listConnectedHostIds())
          void this.refresh(hostId, "always");
      } else if (
        message.entity === "host" &&
        message.id &&
        message.changes.includes("host-connected")
      ) {
        void this.refresh(message.id, "always");
      }
    });
  }

  async snapshot(hostId: string) {
    const revision = ++this.revision;
    const entries = await resolveHostEnvironment(this.deps, {
      hostId,
      projectId: null,
    });
    return { revision, entries };
  }

  async recheck(hostId: string): Promise<void> {
    const checkedAt = this.checkedAtByHostId.get(hostId);
    if (checkedAt !== undefined && Date.now() - checkedAt < RECHECK_INTERVAL_MS)
      return;
    await this.refresh(hostId, "if-changed");
  }

  private refresh(
    hostId: string,
    mode: "always" | "if-changed",
  ): Promise<void> {
    this.checkedAtByHostId.set(hostId, Date.now());
    const request = this.snapshot(hostId);
    const revision = this.revision;
    this.pending.set(hostId, revision);
    return request
      .then((environment) => {
        if (this.pending.get(hostId) !== revision) return;
        this.pending.delete(hostId);
        const entries = JSON.stringify(environment.entries);
        const previous = this.sentEntriesByHostId.get(hostId);
        if (mode === "if-changed" && previous === entries) return;
        const sent = this.deps.hub.sendDaemonMessage(hostId, {
          type: "machine-environment.replace",
          environment,
        });
        if (!sent) return;
        this.sentEntriesByHostId.set(hostId, entries);
        if (previous !== undefined && previous !== entries) {
          this.onEnvironmentChanged(hostId);
        }
      })
      .catch(() => {
        if (this.pending.get(hostId) === revision) this.pending.delete(hostId);
        this.deps.logger.warn(
          { hostId },
          "Failed to synchronize machine environment",
        );
      });
  }
}
