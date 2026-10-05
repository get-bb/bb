import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

export function ReadThreadsDisclosure({
  hiddenCount,
  revealReadThreads,
}: {
  hiddenCount: number;
  revealReadThreads: () => void;
}) {
  if (hiddenCount === 0) return null;
  return (
    <Button
      variant="ghost"
      size="sm"
      className="gap-1 font-normal text-subtle-foreground focus-visible:text-foreground [&_[data-icon-root]]:size-3"
      onClick={revealReadThreads}
    >
      <Icon name="ChevronRight" aria-hidden="true" />
      {hiddenCount} read
    </Button>
  );
}
