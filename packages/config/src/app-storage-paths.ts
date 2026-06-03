import { join } from "node:path";
import { applicationIdSchema, type ApplicationId } from "@bb/domain";

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

export function resolveApplicationDataPath(
  dataDir: string,
  applicationId: ApplicationId,
): string {
  return join(resolveApplicationPath(dataDir, applicationId), "data");
}
