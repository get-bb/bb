import { Skeleton } from "@bb/shared-ui/skeleton";
import { defineSplit, SplitLoadFailure } from "@/lib/define-split";

function FooterCustomizePlaceholder({
  onDone,
  retry,
}: {
  onDone: () => void;
  retry?: () => void;
}) {
  return (
    <div
      className="rounded-lg bg-sidebar-accent/40 p-2"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onDone();
        }
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm">Customize footer</span>
        <button
          type="button"
          className="px-2 py-1 text-sm"
          onClick={onDone}
          autoFocus
        >
          Done
        </button>
      </div>
      {retry ? (
        <SplitLoadFailure retry={retry} />
      ) : (
        <div
          role="status"
          aria-label="Loading footer customization"
          className="space-y-3 py-3"
        >
          <div className="flex gap-2" aria-hidden="true">
            <Skeleton className="size-8 rounded-md" />
            <Skeleton className="size-8 rounded-md" />
            <Skeleton className="size-8 rounded-md" />
          </div>
          <Skeleton className="h-3 w-2/3" />
        </div>
      )}
    </div>
  );
}

export const LazySidebarFooterCustomize = defineSplit<{ onDone: () => void }>({
  id: "sidebar-footer-customize",
  load: () =>
    import("./SidebarFooterCustomize").then(
      (module) => module.SidebarFooterCustomize,
    ),
  loading: FooterCustomizePlaceholder,
  error: FooterCustomizePlaceholder,
  preload: "render",
});
