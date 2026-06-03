import { join } from "node:path";
import type { ApplicationId } from "@bb/domain";

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
  return join(resolveAppsRootPath(dataDir), applicationId);
}

export function resolveApplicationManifestPath(
  dataDir: string,
  applicationId: ApplicationId,
): string {
  return join(resolveApplicationPath(dataDir, applicationId), "manifest.json");
}

export function resolveApplicationAssetsPath(
  dataDir: string,
  applicationId: ApplicationId,
): string {
  return join(resolveApplicationPath(dataDir, applicationId), "assets");
}

export function resolveApplicationDataPath(
  dataDir: string,
  applicationId: ApplicationId,
): string {
  return join(resolveApplicationPath(dataDir, applicationId), "data");
}
