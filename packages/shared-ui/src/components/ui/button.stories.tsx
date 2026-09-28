import { useState } from "react";
import { Button, type ButtonProps } from "./button.js";
import { Icon } from "./icon.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/Button",
};

type ButtonVariant = NonNullable<ButtonProps["variant"]>;
type ButtonSize = NonNullable<ButtonProps["size"]>;

const variants: readonly ButtonVariant[] = [
  "default",
  "secondary",
  "outline",
  "ghost",
  "destructive",
  "link",
];

const sizes: readonly ButtonSize[] = ["sm", "default", "lg", "icon"];

const VARIANT_LABEL: Record<ButtonVariant, string> = {
  default: "Save changes",
  secondary: "Cancel",
  outline: "Connect repo",
  ghost: "Settings",
  destructive: "Delete project",
  link: "View docs",
};

function ArchiveThreadRowDemo() {
  const [archived, setArchived] = useState(false);
  const [restoring, setRestoring] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
      <span className="min-w-0 flex-1 truncate">Sprint planning notes</span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={`${archived ? "Restore" : "Archive"} thread`}
        disabled={restoring}
        onClick={(event) => {
          event.preventDefault();
          if (archived) {
            setRestoring(true);
            setTimeout(() => {
              setArchived(false);
              setRestoring(false);
            }, 400);
            return;
          }
          setArchived(true);
        }}
      >
        <Icon name={archived ? "ArchiveRestore" : "Archive"} />
      </Button>
    </div>
  );
}

function LoadMoreArchivedDemo() {
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const hasNextPage = page < 3;
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={loading}
      onClick={() => {
        setLoading(true);
        setTimeout(() => {
          setPage((current) => current + 1);
          setLoading(false);
        }, 400);
      }}
    >
      {loading ? "Loading…" : hasNextPage ? "Show more" : "No more results"}
    </Button>
  );
}

export function Overview() {
  return (
    <>
      <StoryCard columns={sizes}>
        {variants.map((variant) => (
          <StoryRow key={variant} label={variant}>
            {sizes.map((size) => (
              <Button
                key={size}
                variant={variant}
                size={size}
                aria-label={
                  size === "icon" ? VARIANT_LABEL[variant] : undefined
                }
              >
                {size === "icon" ? (
                  <Icon name="Plus" />
                ) : (
                  VARIANT_LABEL[variant]
                )}
              </Button>
            ))}
          </StoryRow>
        ))}
      </StoryCard>
      <StoryCard>
        <StoryRow label="with icons">
          <Button>
            <Icon name="Check" />
            Save changes
          </Button>
          <Button variant="outline" size="sm">
            Add local path
            <Icon name="ArrowRight" />
          </Button>
        </StoryRow>
        <StoryRow label="disabled">
          {variants.map((variant) => (
            <Button key={variant} variant={variant} disabled>
              {variant}
            </Button>
          ))}
        </StoryRow>
        <StoryRow
          label="Icon-only row action"
          hint="plugins/thread-list/ThreadActionsMenu.tsx — ghost icon-size button toggling archive state"
        >
          <ArchiveThreadRowDemo />
        </StoryRow>
        <StoryRow
          label="Async pagination trigger"
          hint="plugins/thread-list/ProjectList.tsx — ghost sm button whose label reflects fetch-next-page state"
        >
          <LoadMoreArchivedDemo />
        </StoryRow>
      </StoryCard>
    </>
  );
}
