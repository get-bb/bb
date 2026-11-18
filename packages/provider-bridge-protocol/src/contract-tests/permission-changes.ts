import { deepStrictEqual } from "node:assert";
import type { RuntimePermissionPolicy } from "@bb/domain";
import {
  EMPTY_SESSION_SETTINGS_APPLY,
  classifySessionSettingChange,
  type SessionSettingsApply,
  type SessionSettingsDeclaration,
} from "../session-contract.js";

type PermissionMode = RuntimePermissionPolicy["permissionMode"];

export interface PermissionChangeCase {
  before: PermissionMode;
  after: PermissionMode;
}

export interface PermissionChangeDriver {
  initialize(): Promise<void>;
  declaration(): SessionSettingsDeclaration;
  start(options: RuntimePermissionPolicy): Promise<void>;
  turn(
    options: RuntimePermissionPolicy,
    apply: SessionSettingsApply,
  ): Promise<void>;
  resume(options: RuntimePermissionPolicy): Promise<void>;
  observe(): Promise<{ mode: PermissionMode; sandbox: boolean }>;
}

export function permissionChangeCases(
  modes: readonly PermissionMode[],
): PermissionChangeCase[] {
  return modes.flatMap((before) =>
    modes
      .filter((after) => after !== before)
      .map((after) => ({ before, after })),
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
  await driver.initialize();
  const before = permissionChangeOptions(scenario.before);
  const after = permissionChangeOptions(scenario.after);
  await driver.start(before);
  await driver.turn(before, EMPTY_SESSION_SETTINGS_APPLY);
  deepStrictEqual(await driver.observe(), {
    mode: scenario.before,
    sandbox: scenario.before !== "full",
  });
  const apply = classifySessionSettingChange(driver.declaration(), {
    setting: "permission",
    value: scenario.after,
  });
  if (apply === "fresh") {
    throw new Error(
      `the bridge declares a permission change to ${scenario.after} fresh; bb could never apply it to a running session`,
    );
  }
  if (apply === "resume") {
    await driver.resume(after);
    await driver.turn(after, EMPTY_SESSION_SETTINGS_APPLY);
  } else {
    await driver.turn(after, {
      ...EMPTY_SESSION_SETTINGS_APPLY,
      settings: ["permission"],
    });
  }
  deepStrictEqual(await driver.observe(), {
    mode: scenario.after,
    sandbox: scenario.after !== "full",
  });
}
