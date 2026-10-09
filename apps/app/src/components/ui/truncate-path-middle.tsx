import { cn } from "@bb/shared-ui/lib/utils";
import { TruncateStart } from "./truncate-start";

const KEPT_TAIL_SEGMENTS = 2;

export function splitPathForMiddleTruncation(path: string): {
  head: string;
  tail: string;
} {
  let splitIndex = path.length;
  for (let kept = 0; kept < KEPT_TAIL_SEGMENTS; kept += 1) {
    splitIndex = Math.max(
      path.lastIndexOf("/", splitIndex - 1),
      path.lastIndexOf("\\", splitIndex - 1),
    );
    if (splitIndex <= 0) return { head: "", tail: path };
  }
  return { head: path.slice(0, splitIndex), tail: path.slice(splitIndex) };
}

export function TruncatePathMiddle({
  path,
  className,
}: {
  path: string;
  className?: string;
}) {
  const { head, tail } = splitPathForMiddleTruncation(path);
  return (
    <span className={cn("flex min-w-0", className)}>
      {head ? (
        <span className="min-w-6 truncate [flex-shrink:9999]">{head}</span>
      ) : null}
      <TruncateStart className="min-w-0">{tail}</TruncateStart>
    </span>
  );
}
