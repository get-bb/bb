import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  PULL_REQUEST_NEXT_STEP_TONE_CLASS,
  type PullRequestNextStep,
} from "@/lib/pull-request-display";

export function PullRequestNextStepLabel({
  nextStep,
  className,
}: {
  nextStep: PullRequestNextStep;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "flex min-w-0 items-center gap-1",
        PULL_REQUEST_NEXT_STEP_TONE_CLASS[nextStep.tone],
        className,
      )}
    >
      {nextStep.icon ? (
        <Icon
          name={nextStep.icon}
          className={cn(
            "size-3 shrink-0",
            nextStep.running && "animate-shine-icon",
          )}
          aria-hidden
        />
      ) : null}
      <span
        className={cn("min-w-0 truncate", nextStep.running && "animate-shine")}
      >
        {nextStep.label}
      </span>
    </span>
  );
}
