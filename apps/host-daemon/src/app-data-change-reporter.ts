import type { HostDaemonAppDataChangePayload } from "@bb/host-daemon-contract";
import {
  appDataPathSchema,
  applicationIdSchema,
  type AppDataPath,
  type ApplicationId,
} from "@bb/domain";
import { CommandDispatchError } from "./command-dispatch-support.js";
import { runtimeErrorLogFields } from "./error-utils.js";
import type { HostDaemonLogger } from "./logger.js";
import {
  listApplicationDataFromTargets,
  readApplicationDataFromTarget,
  type ApplicationDataEntry,
  type ApplicationDataTarget,
} from "./app-data-files.js";

interface CreateAppDataChangeReporterOptions {
  logger: HostDaemonLogger;
  postAppDataChange: (payload: HostDaemonAppDataChangePayload) => Promise<void>;
  postAppDataResync: (payload: AppDataResyncPayload) => Promise<void>;
}

interface AppDataCacheEntry {
  version: string;
}

interface AppDataResyncPayload {
  applicationId: ApplicationId;
}

interface AppDataCacheKeyArgs {
  applicationId: ApplicationId;
  path: AppDataPath;
}

interface ReportObservedDeleteArgs extends AppDataCacheKeyArgs {
  generation: number;
}

interface ReportObservedChangeArgs {
  change: ObserveAppDataChangeArgs;
  generation: number;
}

interface AppDataReporterGenerationArgs {
  generation: number;
}

interface ReplaceTrackedApplicationDataTargetsArgs {
  targets: readonly ApplicationDataTarget[];
}

interface ReprimeApplicationsArgs {
  generation: number;
  targets: readonly ApplicationDataTarget[];
}

interface ApplyApplicationSnapshotArgs extends ReprimeApplicationsArgs {
  snapshotEntries: readonly ApplicationDataEntry[];
  snapshotApplicationIds: readonly ApplicationId[];
}

interface CachedAppDataKey {
  applicationId: ApplicationId;
  cacheKey: string;
  path: AppDataPath;
}

export interface ObserveAppDataChangeArgs {
  applicationId: ApplicationId;
  appDataPath: string;
  path: AppDataPath;
}

function appDataCacheKey(args: AppDataCacheKeyArgs): string {
  return `${args.applicationId}\0${args.path}`;
}

function isMissingAppDataEntryError(error: Error): boolean {
  return error instanceof CommandDispatchError && error.code === "ENOENT";
}

function isNonReportableAppDataReadError(error: Error): boolean {
  return (
    error instanceof CommandDispatchError &&
    (error.code === "invalid_json" ||
      error.code === "invalid_path" ||
      error.code === "file_too_large")
  );
}

export class AppDataChangeReporter {
  private readonly cache = new Map<string, AppDataCacheEntry>();
  private readonly pendingByCacheKey = new Map<string, Promise<void>>();
  private readonly trackedTargets = new Map<ApplicationId, ApplicationDataTarget>();
  private generation = 0;

  constructor(private readonly options: CreateAppDataChangeReporterOptions) {}

  async replaceTrackedApplications(
    args: ReplaceTrackedApplicationDataTargetsArgs,
  ): Promise<void> {
    this.generation += 1;
    const generation = this.generation;
    this.replaceTrackedTargets(args.targets);
    this.pendingByCacheKey.clear();
    await this.reprimeApplications({
      generation,
      targets: args.targets,
    });
  }

  observe(args: ObserveAppDataChangeArgs): Promise<void> {
    const target = this.trackedTargets.get(args.applicationId);
    if (!target) {
      return Promise.resolve();
    }
    const cacheKey = appDataCacheKey(args);
    const generation = this.generation;
    const previous = this.pendingByCacheKey.get(cacheKey) ?? Promise.resolve();
    const pending = previous
      .catch(() => undefined)
      .then(() =>
        this.reportObservedChange({
          change: {
            applicationId: args.applicationId,
            appDataPath: target.appDataPath,
            path: args.path,
          },
          generation,
        }),
      )
      .catch((error) => {
        this.options.logger.warn(
          {
            applicationId: args.applicationId,
            path: args.path,
            ...runtimeErrorLogFields(error),
          },
          "Failed to report observed app data change",
        );
      })
      .finally(() => {
        if (this.pendingByCacheKey.get(cacheKey) === pending) {
          this.pendingByCacheKey.delete(cacheKey);
        }
      });
    this.pendingByCacheKey.set(cacheKey, pending);
    return pending;
  }

  requestResync(args: AppDataResyncPayload): Promise<void> {
    return this.postResyncHint(args);
  }

  private isCurrentGeneration(args: AppDataReporterGenerationArgs): boolean {
    return args.generation === this.generation;
  }

  private replaceTrackedTargets(
    targets: readonly ApplicationDataTarget[],
  ): void {
    const nextApplicationIds = new Set(
      targets.map((target) => target.applicationId),
    );
    for (const applicationId of Array.from(this.trackedTargets.keys())) {
      if (nextApplicationIds.has(applicationId)) {
        continue;
      }
      this.trackedTargets.delete(applicationId);
      for (const cached of this.cachedKeysForApplication({ applicationId })) {
        this.cache.delete(cached.cacheKey);
      }
    }
    for (const target of targets) {
      this.trackedTargets.set(target.applicationId, target);
    }
  }

  private cachedKeysForApplication(args: {
    applicationId: ApplicationId;
  }): CachedAppDataKey[] {
    const prefix = `${args.applicationId}\0`;
    return Array.from(this.cache.keys())
      .filter((cacheKey) => cacheKey.startsWith(prefix))
      .map((cacheKey) => {
        const [rawApplicationId, rawDataPath] = cacheKey.split("\0");
        return {
          applicationId: applicationIdSchema.parse(rawApplicationId),
          path: appDataPathSchema.parse(rawDataPath),
          cacheKey,
        };
      });
  }

  private async reprimeApplications(
    args: ReprimeApplicationsArgs,
  ): Promise<void> {
    try {
      const snapshot = await listApplicationDataFromTargets({
        targets: args.targets,
      });
      if (!this.isCurrentGeneration({ generation: args.generation })) {
        return;
      }
      const previousApplicationIds = new Set(this.trackedTargets.keys());
      await this.applyApplicationSnapshot({
        ...args,
        snapshotEntries: snapshot.entries,
        snapshotApplicationIds: snapshot.applicationIds,
      });
      const resyncApplicationIds = new Set<ApplicationId>([
        ...previousApplicationIds,
        ...snapshot.applicationIds,
      ]);
      await Promise.all(
        Array.from(resyncApplicationIds)
          .sort((left, right) => left.localeCompare(right))
          .map((applicationId) =>
            this.postResyncHint({
              applicationId,
            }),
          ),
      );
    } catch (error) {
      this.options.logger.warn(
        {
          ...runtimeErrorLogFields(error),
        },
        "Failed to reprime app data change cache",
      );
    }
  }

  private async applyApplicationSnapshot(
    args: ApplyApplicationSnapshotArgs,
  ): Promise<void> {
    const seenCacheKeys = new Set<string>();
    for (const snapshotEntry of args.snapshotEntries) {
      if (!this.isCurrentGeneration({ generation: args.generation })) {
        return;
      }
      const cacheKey = appDataCacheKey({
        applicationId: snapshotEntry.applicationId,
        path: snapshotEntry.entry.path,
      });
      seenCacheKeys.add(cacheKey);
      this.cache.set(cacheKey, { version: snapshotEntry.entry.version });
    }
    for (const applicationId of args.snapshotApplicationIds) {
      for (const cached of this.cachedKeysForApplication({ applicationId })) {
        if (!seenCacheKeys.has(cached.cacheKey)) {
          this.cache.delete(cached.cacheKey);
        }
      }
    }
  }

  private async postResyncHint(args: AppDataResyncPayload): Promise<void> {
    try {
      await this.options.postAppDataResync(args);
    } catch (error) {
      this.options.logger.warn(
        {
          applicationId: args.applicationId,
          ...runtimeErrorLogFields(error),
        },
        "Failed to report app data resync hint",
      );
    }
  }

  private async reportObservedChange(
    args: ReportObservedChangeArgs,
  ): Promise<void> {
    if (!this.isCurrentGeneration({ generation: args.generation })) {
      return;
    }
    const target = this.trackedTargets.get(args.change.applicationId);
    if (!target) {
      return;
    }
    const cacheKey = appDataCacheKey(args.change);
    const previous = this.cache.get(cacheKey);

    try {
      const entry = await readApplicationDataFromTarget({
        path: args.change.path,
        target,
      });
      if (!this.isCurrentGeneration({ generation: args.generation })) {
        return;
      }
      if (previous?.version === entry.version) {
        return;
      }
      await this.options.postAppDataChange({
        applicationId: args.change.applicationId,
        path: entry.path,
        deleted: false,
        value: entry.value,
        version: entry.version,
      });
      if (!this.isCurrentGeneration({ generation: args.generation })) {
        return;
      }
      this.cache.set(cacheKey, { version: entry.version });
    } catch (error) {
      if (error instanceof Error && isMissingAppDataEntryError(error)) {
        await this.reportObservedDelete({
          applicationId: args.change.applicationId,
          generation: args.generation,
          path: args.change.path,
        });
        return;
      }
      if (error instanceof Error && isNonReportableAppDataReadError(error)) {
        this.options.logger.warn(
          {
            applicationId: args.change.applicationId,
            path: args.change.path,
            ...runtimeErrorLogFields(error),
          },
          "Ignoring unreadable observed app data file",
        );
        return;
      }
      throw error;
    }
  }

  private async reportObservedDelete(
    args: ReportObservedDeleteArgs,
  ): Promise<void> {
    if (!this.isCurrentGeneration({ generation: args.generation })) {
      return;
    }
    const cacheKey = appDataCacheKey(args);
    if (!this.cache.has(cacheKey)) {
      return;
    }
    await this.options.postAppDataChange({
      applicationId: args.applicationId,
      path: args.path,
      deleted: true,
      value: null,
      version: null,
    });
    if (!this.isCurrentGeneration({ generation: args.generation })) {
      return;
    }
    this.cache.delete(cacheKey);
  }
}
