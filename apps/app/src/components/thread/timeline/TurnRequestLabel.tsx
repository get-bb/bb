import type { TimelineConversationTurnRequest } from "@bb/server-contract";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { turnRequestLabel } from "./conversation-turn-request-label.js";

interface TurnRequestLabelProps {
  turnRequest: TimelineConversationTurnRequest;
  /** Leading glyph. Defaults to the steer corner-arrow. */
  icon?: IconName;
}

/**
 * The "steer" turn-request pill shown under a user or generated message.
 * Renders nothing for non-steer requests; pulses while a steer is still
 * pending. Callers own the surrounding toolbar row (alignment, copy button).
 */
export function TurnRequestLabel({
  turnRequest,
  icon = "CornerDownRight",
}: TurnRequestLabelProps) {
  const label = turnRequestLabel(turnRequest);
  if (label === null) {
    return null;
  }
  const isPendingSteer =
    turnRequest.kind === "steer" && turnRequest.status === "pending";
  return (
    <span
      className={cn(
        "shrink-0 whitespace-nowrap text-xs leading-none text-muted-foreground",
        isPendingSteer && "animate-shine",
      )}
    >
      <Icon name={icon} className="mr-1 inline-block size-3 align-middle" />
      {label}
    </span>
  );
}
