import { Badge } from "./badge.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/Badge",
};

function PullStateBadge({
  state,
}: {
  state: "DRAFT" | "OPEN" | "MERGED" | "CLOSED";
}) {
  const parts =
    state === "DRAFT"
      ? { dot: "bg-muted-foreground/60", label: "draft" }
      : state === "OPEN"
        ? { dot: "bg-green-500", label: "open" }
        : state === "MERGED"
          ? { dot: "bg-purple-500", label: "merged" }
          : { dot: "bg-red-500", label: "closed" };
  return (
    <Badge variant="outline" className="gap-1.5 font-normal">
      <span className={`size-2 shrink-0 rounded-full ${parts.dot}`} />
      {parts.label}
    </Badge>
  );
}

function ReviewDecisionBadge({
  decision,
}: {
  decision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED";
}) {
  if (decision === "APPROVED") {
    return (
      <Badge className="bg-green-600 text-white hover:bg-green-600">
        approved
      </Badge>
    );
  }
  if (decision === "CHANGES_REQUESTED") {
    return <Badge variant="destructive">changes requested</Badge>;
  }
  return <Badge variant="secondary">review required</Badge>;
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="PR state dot badge"
        hint="plugins/github/app.tsx — outline badge with a colored status dot per pull-request state"
      >
        <PullStateBadge state="DRAFT" />
        <PullStateBadge state="OPEN" />
        <PullStateBadge state="MERGED" />
        <PullStateBadge state="CLOSED" />
      </StoryRow>
      <StoryRow
        label="Review decision"
        hint="plugins/github/app.tsx — semantic badge variants for a review decision"
      >
        <ReviewDecisionBadge decision="APPROVED" />
        <ReviewDecisionBadge decision="CHANGES_REQUESTED" />
        <ReviewDecisionBadge decision="REVIEW_REQUIRED" />
      </StoryRow>
    </StoryCard>
  );
}
