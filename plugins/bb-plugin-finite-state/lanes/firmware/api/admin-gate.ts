import { RemoteError } from "../../../lib/remote/types.js";
import { FirmwareCacheError } from "../cache/layout.js";
import type { FirmwareManifest, FirmwareMount } from "../cache/manifest.js";
import type { ApiFirmwareDeps } from "./fallback.js";

export const ADMIN_BYTES_RECOVERY =
  "Firmware bytes require the org-admin VIEW_ANY_PROJECT_FILE permission. Metadata remains available; use local standalone unpack with the firmware image for a complete rootfs.";

export function isFirmwareAdminBytesForbidden(error: unknown): boolean {
  return error instanceof RemoteError && error.service === "platform" && error.status === 403;
}

export function recordAdminBytesRequired(
  deps: ApiFirmwareDeps,
  manifest: FirmwareManifest,
  mount: FirmwareMount,
): never {
  const meta = manifest.readMeta();
  if (meta !== null) {
    manifest.writeMeta({
      ...meta,
      adminBytesOk: false,
      fullyMaterialized: false,
      unpackErrors: meta.unpackErrors.includes(ADMIN_BYTES_RECOVERY)
        ? meta.unpackErrors
        : [...meta.unpackErrors, ADMIN_BYTES_RECOVERY],
    });
  }
  const readiness = deps.cache.readiness(manifest);
  const counts = manifest.counts();
  const gatedMount: FirmwareMount = {
    ...mount,
    readiness,
    nodeCount: counts.nodes,
    hydratedCount: counts.hydrated,
    errors: mount.errors.includes(ADMIN_BYTES_RECOVERY)
      ? mount.errors
      : [...mount.errors, ADMIN_BYTES_RECOVERY],
  };
  deps.cache.commit({
    scope: deps.scope,
    manifest,
    mount: gatedMount,
    scanId: meta?.scanId ?? null,
    adminBytesOk: false,
    pulledAt: (deps.now ?? (() => new Date()))().toISOString(),
  });
  throw new FirmwareCacheError("FIRMWARE_ADMIN_BYTES_REQUIRED", ADMIN_BYTES_RECOVERY);
}
