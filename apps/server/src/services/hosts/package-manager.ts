import { getHost } from "@bb/db";
import type { PackageManagerPreference } from "@bb/domain";
import type { AppDeps } from "../../types.js";

type PackageManagerDeps = Pick<AppDeps, "db">;

export function resolveHostPackageManager(
  deps: PackageManagerDeps,
  hostId: string,
): PackageManagerPreference {
  const host = getHost(deps.db, hostId);
  return host?.packageManagerOverride ?? host?.packageManager ?? "auto";
}
