import { deepStrictEqual } from "node:assert";
import type { RuntimePermissionPolicy } from "@bb/domain";

type PermissionMode = RuntimePermissionPolicy["permissionMode"];

export interface PermissionChangeCase {
  before: PermissionMode;
  after: PermissionMode;
  method: "turn/start" | "turn/steer";
}

export interface PermissionChangeDriver {
  start(options: RuntimePermissionPolicy): Promise<void>;
  dispatch(
    method: PermissionChangeCase["method"],
    options: RuntimePermissionPolicy,
    hold: boolean,
  ): Promise<void>;
  observe(): Promise<{ mode: PermissionMode; sandbox: boolean }>;
}

export function permissionChangeCases(
  modes: readonly PermissionMode[],
): PermissionChangeCase[] {
  return modes.flatMap((before) =>
    modes
      .filter((after) => after !== before)
      .flatMap((after) =>
        (["turn/start", "turn/steer"] as const).map((method) => ({
          before,
          after,
          method,
        })),
      ),
  );
}

function permissionChangeOptions(
  mode: PermissionMode,
): RuntimePermissionPolicy {
  return mode === "full"
    ? {
        permissionMode: mode,
        permissionScope: "full",
        approvalReviewer: null,
        permissionEscalation: null,
      }
    : mode === "auto"
      ? {
          permissionMode: "auto",
          permissionScope: "workspace",
          approvalReviewer: "automatic",
          permissionEscalation: "ask",
        }
      : {
          permissionMode: "accept-edits",
          permissionScope: "workspace",
          approvalReviewer: "user",
          permissionEscalation: "ask",
        };
}

export async function runPermissionChangeCase(
  driver: PermissionChangeDriver,
  scenario: PermissionChangeCase,
): Promise<void> {
  await driver.start(permissionChangeOptions(scenario.before));
  await driver.dispatch(
    "turn/start",
    permissionChangeOptions(scenario.before),
    scenario.method === "turn/steer",
  );
  deepStrictEqual(await driver.observe(), {
    mode: scenario.before,
    sandbox: scenario.before !== "full",
  });
  await driver.dispatch(
    scenario.method,
    permissionChangeOptions(scenario.after),
    false,
  );
  deepStrictEqual(await driver.observe(), {
    mode: scenario.after,
    sandbox: scenario.after !== "full",
  });
}
