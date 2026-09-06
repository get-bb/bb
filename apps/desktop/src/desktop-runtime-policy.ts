import type { ForeignRuntimeDetails } from "./foreign-runtime.js";
import type { RuntimeOwnership } from "./types.js";

interface ShouldAutoAttachToForeignRuntimeArgs {
  desktopVersion: string | null;
  details: ForeignRuntimeDetails | null;
}

interface ShouldStopRuntimeOnQuitArgs {
  ownership: RuntimeOwnership;
}

export function shouldAutoAttachToForeignRuntime(
  args: ShouldAutoAttachToForeignRuntimeArgs,
): boolean {
  return (
    args.desktopVersion !== null &&
    args.details !== null &&
    args.details.version === args.desktopVersion
  );
}

export function shouldStopRuntimeOnQuit(
  args: ShouldStopRuntimeOnQuitArgs,
): boolean {
  return args.ownership === "spawned";
}
