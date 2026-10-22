import type { SystemProviderState } from "@bb/server-contract";
import type { ComposerBlockedAction } from "./PromptBoxInternal";

export interface ComposerSignInState {
  placeholder: string;
  blockedAction: ComposerBlockedAction | undefined;
}

export function resolveComposerSignInState(
  state: Pick<SystemProviderState, "displayName" | "status"> | undefined,
  onSignIn: (() => void) | null,
): ComposerSignInState | null {
  if (state?.status !== "unauthenticated" && state?.status !== "expired") {
    return null;
  }
  const problem =
    state.status === "expired"
      ? `Your ${state.displayName} session expired`
      : `${state.displayName} isn't signed in`;
  return onSignIn === null
    ? {
        placeholder: `${problem} on this thread's machine`,
        blockedAction: undefined,
      }
    : {
        placeholder: problem,
        blockedAction: { label: "Sign in", onAction: onSignIn },
      };
}
