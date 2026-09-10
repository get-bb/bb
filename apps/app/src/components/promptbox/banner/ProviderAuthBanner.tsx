import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { PromptStackCard } from "@/components/promptbox/banner/PromptStackCard";

export interface ThreadPromptProviderAuthSection {
  displayName: string;
  loginCommand: string | null;
  canSignIn: boolean;
  signingIn: boolean;
  onSignIn: () => void;
}

function signInCopy(loginCommand: string | null, canSignIn: boolean): string {
  if (canSignIn) {
    return "Sign in again to continue this thread.";
  }
  if (loginCommand !== null) {
    return `Run ${loginCommand} where this thread runs, then send again.`;
  }
  return "Sign in again where this thread runs, then send again.";
}

export function ProviderAuthBanner({
  displayName,
  loginCommand,
  canSignIn,
  signingIn,
  onSignIn,
}: ThreadPromptProviderAuthSection) {
  return (
    <PromptStackCard
      ariaLabel={`${displayName} sign-in required`}
      className="overflow-hidden border-attention/50 bg-surface-attention shadow-sm"
    >
      <div
        role="alert"
        className="flex min-h-14 max-w-full items-center gap-3 px-3 py-2.5"
      >
        <span
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-attention/15 text-warning-text ring-1 ring-attention/25"
          aria-hidden
        >
          <Icon name="Lock" className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">
            {displayName} sign-in required
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            The last turn failed because the {displayName} session is no longer
            authorized. {signInCopy(loginCommand, canSignIn)}
          </p>
        </div>
        {canSignIn ? (
          <Button
            type="button"
            size="sm"
            className="h-8 shrink-0 px-3"
            disabled={signingIn}
            onClick={onSignIn}
          >
            {signingIn ? (
              <>
                <Icon name="Spinner" className="animate-spin" />
                Opening…
              </>
            ) : (
              `Sign in to ${displayName}`
            )}
          </Button>
        ) : null}
      </div>
    </PromptStackCard>
  );
}
