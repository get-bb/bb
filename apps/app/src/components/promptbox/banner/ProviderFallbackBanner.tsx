import type { ProviderFallbackDecision } from "@bb/domain";
import { Button } from "@bb/shared-ui/button";
import { ProviderRequirementBanner } from "./ProviderRequirementBanner";

const RESET_FORMAT = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  hour: "numeric",
  minute: "2-digit",
});

export function describeProviderFallback(args: {
  fallback: ProviderFallbackDecision;
  fromName: string;
  toName: string;
}): { title: string; description: string } {
  const resetsAt =
    args.fallback.exhausted.resetsAt === null
      ? Number.NaN
      : Date.parse(args.fallback.exhausted.resetsAt);
  return {
    title: `Starts on ${args.toName}`,
    description: `${args.fromName} is out of usage (${args.fallback.exhausted.label})${
      Number.isFinite(resetsAt)
        ? ` until ${RESET_FORMAT.format(new Date(resetsAt))}`
        : ""
    }.`,
  };
}

export function ProviderFallbackBanner({
  fallback,
  fromName,
  toName,
  onUseDefault,
}: {
  fallback: ProviderFallbackDecision;
  fromName: string;
  toName: string;
  onUseDefault: () => void;
}) {
  const { title, description } = describeProviderFallback({
    fallback,
    fromName,
    toName,
  });
  return (
    <ProviderRequirementBanner
      title={title}
      description={description}
      action={
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="h-8 shrink-0 px-3"
          onClick={onUseDefault}
        >
          Use {fromName}
        </Button>
      }
    />
  );
}
