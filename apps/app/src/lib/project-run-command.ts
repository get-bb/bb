import { isActiveTerminalSessionStatus } from "@bb/domain";
import type {
  ProjectRunCommandTarget,
  ProjectRunCommandTargetState,
} from "@bb/server-contract";

export function runCommandTargetKey(target: ProjectRunCommandTarget): string {
  switch (target.kind) {
    case "project":
      return "project";
    case "environment":
      return `environment:${target.environmentId}`;
  }
}

export function getRunCommandStateForTarget(
  states: readonly ProjectRunCommandTargetState[],
  target: ProjectRunCommandTarget,
): ProjectRunCommandTargetState | undefined {
  const key = runCommandTargetKey(target);
  return states.find((state) => runCommandTargetKey(state.target) === key);
}

export function isRunCommandStateActive(
  state: ProjectRunCommandTargetState | undefined,
): boolean {
  return state?.status ? isActiveTerminalSessionStatus(state.status) : false;
}
