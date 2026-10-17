import { Button } from "@/components/ui/button";
export function RefreshError({
  message,
  onRetry,
}: {
  message: string;
  onRetry(): void;
}) {
  return (
    <div
      role="alert"
      className="flex items-center gap-2 p-2 text-sm text-destructive"
    >
      <span>{message}</span>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}
