import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

const managedInstallMarkerSchema = z.object({
  kind: z.literal("pi-managed-install"),
  schemaVersion: z.literal(1),
  layout: z.literal("releases-v1"),
});

const PI_LAUNCHER_NAMES = new Set(["pi", "pi.cmd", "pi.ps1"]);

export function resolvePiManagedInstallRoot(
  executablePath: string,
): string | null {
  try {
    const launcher = realpathSync(executablePath);
    if (!PI_LAUNCHER_NAMES.has(path.basename(launcher).toLowerCase())) {
      return null;
    }
    const installRoot = path.join(
      path.dirname(path.dirname(launcher)),
      "install",
    );
    const marker = managedInstallMarkerSchema.safeParse(
      JSON.parse(
        readFileSync(
          path.join(installRoot, "managed-install.json"),
          "utf8",
        ).replace(/^﻿/u, ""),
      ),
    );
    return marker.success ? installRoot : null;
  } catch {
    return null;
  }
}
