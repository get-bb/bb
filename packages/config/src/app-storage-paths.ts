import { join } from "node:path";
import {
  applicationIdSchema,
  appSourceNameSchema,
  type ApplicationId,
  type AppSourceName,
} from "@bb/domain";

export function resolveAppsRootPath(dataDir: string): string {
  return join(dataDir, "apps");
}

export function resolveDataDirSkillsRootPath(dataDir: string): string {
  return join(dataDir, "skills");
}

export function resolveApplicationPath(
  dataDir: string,
  applicationId: ApplicationId,
): string {
  return join(
    resolveAppsRootPath(dataDir),
    applicationIdSchema.parse(applicationId),
  );
}

export function resolveApplicationManifestPath(
  dataDir: string,
  applicationId: ApplicationId,
): string {
  return join(resolveApplicationPath(dataDir, applicationId), "manifest.json");
}

export function resolveApplicationPublicPath(
  dataDir: string,
  applicationId: ApplicationId,
): string {
  return join(resolveApplicationPath(dataDir, applicationId), "public");
}

export function resolveAppDataRootPath(dataDir: string): string {
  return join(dataDir, "app-data");
}

/**
 * App data lives outside the app folder so app code (author-owned, replaceable
 * by app-source syncs) and runtime data (user-owned) have independent
 * lifecycles. Legacy layouts that kept `data/` inside the app folder are
 * migrated at server boot.
 */
export function resolveApplicationDataPath(
  dataDir: string,
  applicationId: ApplicationId,
): string {
  return join(
    resolveAppDataRootPath(dataDir),
    applicationIdSchema.parse(applicationId),
  );
}

export function resolveLegacyApplicationDataPath(
  dataDir: string,
  applicationId: ApplicationId,
): string {
  return join(resolveApplicationPath(dataDir, applicationId), "data");
}

export function resolveAppSourcesRootPath(dataDir: string): string {
  return join(dataDir, "app-sources");
}

export function resolveAppSourcesConfigPath(dataDir: string): string {
  return join(resolveAppSourcesRootPath(dataDir), "sources.json");
}

export function resolveAppSourcePath(
  dataDir: string,
  sourceName: AppSourceName,
): string {
  return join(
    resolveAppSourcesRootPath(dataDir),
    appSourceNameSchema.parse(sourceName),
  );
}

export function resolveAppSourceRepoPath(
  dataDir: string,
  sourceName: AppSourceName,
): string {
  return join(resolveAppSourcePath(dataDir, sourceName), "repo");
}

export function resolveAppSourceStatePath(
  dataDir: string,
  sourceName: AppSourceName,
): string {
  return join(resolveAppSourcePath(dataDir, sourceName), "state.json");
}
