import type { SystemProviderState } from "@bb/server-contract";
import { Button } from "@bb/shared-ui/button";
import { ProviderRequirementBanner } from "./ProviderRequirementBanner";

export interface ProviderSignInWarning {
  displayName: string;
  reason: "signedOut" | "expired";
}

export function resolveProviderSignInWarning(
  state: Pick<SystemProviderState, "displayName" | "status"> | undefined,
): ProviderSignInWarning | null {
  switch (state?.status) {
    case "unauthenticated":
      return { displayName: state.displayName, reason: "signedOut" };
    case "expired":
      return { displayName: state.displayName, reason: "expired" };
    default:
      return null;
  }
}

export function ProviderSignInBanner({
  warning,
  onSignIn,
}: {
  warning: ProviderSignInWarning;
  onSignIn: (() => void) | null;
}) {
  return (
    <ProviderRequirementBanner
      title={
        warning.reason === "expired"
          ? `Your ${warning.displayName} session expired`
          : `${warning.displayName} isn't signed in`
      }
      description={`Sign in to ${warning.displayName} to start a thread.`}
      action={
        onSignIn === null ? null : (
          <Button
            type="button"
            size="sm"
            className="h-8 shrink-0 px-3"
            onClick={onSignIn}
          >
            Sign in
          </Button>
        )
      }
    />
  );
}
