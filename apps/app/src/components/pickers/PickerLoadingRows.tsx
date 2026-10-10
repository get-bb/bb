import { Skeleton } from "@bb/shared-ui/skeleton";
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
  const rowDataAttributes = { [rowDataAttribute]: "" };

  return (
    <div role="status" aria-label={label} className="pb-1">
      <span className="sr-only">{label}</span>
      {PICKER_LOADING_ROW_WIDTHS.map((widthClassName) => (
        <div
          key={widthClassName}
          {...rowDataAttributes}
          aria-hidden
          className="flex items-center rounded-sm px-2 py-[0.3125rem] max-md:pointer-coarse:py-2"
        >
          <Skeleton
            className={cn("h-3 max-w-[75%] rounded-sm", widthClassName)}
          />
        </div>
      ))}
    </div>
  );
}
