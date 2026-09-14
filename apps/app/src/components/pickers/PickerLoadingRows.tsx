import { Skeleton } from "@bb/shared-ui/skeleton";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { cn } from "@bb/shared-ui/lib/utils";

const PICKER_LOADING_ROW_WIDTHS = ["w-20", "w-28", "w-24", "w-32"] as const;

interface PickerLoadingRowsProps {
  label: string;
  rowDataAttribute: `data-${string}`;
}

export function PickerLoadingRows({
  label,
  rowDataAttribute,
}: PickerLoadingRowsProps) {
  const isCompactViewport = useIsCompactViewport();
  const rowDataAttributes = { [rowDataAttribute]: "" };

  return (
    <div role="status" aria-label={label} className="pb-1">
      <span className="sr-only">{label}</span>
      {PICKER_LOADING_ROW_WIDTHS.map((widthClassName) => (
        <div
          key={widthClassName}
          {...rowDataAttributes}
          aria-hidden
          className={cn(
            "flex items-center rounded-sm px-2",
            isCompactViewport ? "py-2" : "py-[0.3125rem]",
          )}
        >
          <Skeleton
            className={cn("h-3 max-w-[75%] rounded-sm", widthClassName)}
          />
        </div>
      ))}
    </div>
  );
}
