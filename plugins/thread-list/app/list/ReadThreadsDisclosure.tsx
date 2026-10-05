import { Button } from "@/components/ui/button";

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
      className="font-normal text-subtle-foreground focus-visible:text-foreground"
      onClick={revealReadThreads}
    >
      Show {hiddenCount} read {hiddenCount === 1 ? "thread" : "threads"}
    </Button>
  );
}
