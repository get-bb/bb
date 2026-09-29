import { useState, type ReactNode } from "react";
import { SplitPreviewProvider } from "./define-split";
import { LazySidebarFooterCustomize } from "@/components/sidebar/LazySidebarFooterCustomize";
import { LazyFilePreview } from "@/components/secondary-panel/lazySecondaryPanelComponents";

export default { title: "performance/Split review" };

function Review({ id, children }: { id: string; children: ReactNode }) {
  const [state, setState] = useState<"loading" | "error" | "live">("loading");
  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap gap-3" aria-label="Split review controls">
        <button type="button" onClick={() => setState("loading")}>
          Hold loading
        </button>
        <button type="button" onClick={() => setState("error")}>
          Show failure
        </button>
        <button type="button" onClick={() => setState("live")}>
          Release to real UI
        </button>
      </div>
      <p className="text-sm text-muted-foreground">
        {id}: {state}
      </p>
      {state === "live" ? (
        children
      ) : (
        <SplitPreviewProvider
          id={id}
          state={state}
          onRetry={() => setState("live")}
        >
          {children}
        </SplitPreviewProvider>
      )}
    </div>
  );
}

export function FooterCustomization() {
  const [open, setOpen] = useState(true);
  return (
    <Review id={LazySidebarFooterCustomize.id}>
      <div className="w-full max-w-80 rounded-lg bg-sidebar p-2 text-sidebar-foreground">
        {open ? (
          <LazySidebarFooterCustomize onDone={() => setOpen(false)} />
        ) : (
          <button type="button" onClick={() => setOpen(true)}>
            Customize footer
          </button>
        )}
      </div>
    </Review>
  );
}

export function FilePreview() {
  return (
    <Review id={LazyFilePreview.id}>
      <div className="flex h-80 w-full max-w-xl flex-col overflow-auto border border-border bg-background">
        <LazyFilePreview
          path="split-review.md"
          state={{
            kind: "ready",
            file: {
              name: "split-review.md",
              contents:
                "# Split review\n\nThe real preview is loaded.\n\n- Loading stays local\n- The panel keeps its space",
            },
            lineRange: null,
            textPreviewKind: "markdown",
          }}
        />
      </div>
    </Review>
  );
}
