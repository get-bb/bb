import type { AppDeps } from "../../types.js";
import { resolveHostEnvironment } from "./host-environment.js";

export class HostEnvironmentSync {
  private revision = 0;
  private readonly pending = new Map<string, number>();

  constructor(
    private readonly deps: Pick<AppDeps, "db" | "hub"> & {
      config: Pick<AppDeps["config"], "dataDir">;
      logger: Pick<AppDeps["logger"], "warn">;
    },
  ) {
    deps.hub.onChangedMessage((message) => {
      if (
        message.entity === "system" &&
        message.changes.includes("config-changed")
      ) {
        for (const hostId of deps.hub.listConnectedHostIds())
          this.refresh(hostId);
      } else if (
        message.entity === "host" &&
        message.id &&
        message.changes.includes("host-connected")
      ) {
        this.refresh(message.id);
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

  private refresh(hostId: string): void {
    const request = this.snapshot(hostId);
    const revision = this.revision;
    this.pending.set(hostId, revision);
    void request
      .then((environment) => {
        if (this.pending.get(hostId) !== revision) return;
        this.pending.delete(hostId);
        this.deps.hub.sendDaemonMessage(hostId, {
          type: "machine-environment.replace",
          environment,
        });
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
