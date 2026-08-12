import { useBbNavigate } from "@bb/plugin-sdk/app";

export function ProductSecurityHeader(): React.JSX.Element {
  const navigate = useBbNavigate();
  return (
    <div className="flex items-center gap-2">
      <button
        aria-label="Review local product-security changes in Sync"
        className="rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() =>
          navigate.toPluginPanel("sync", { subPath: "product-security" })
        }
        type="button"
      >
        Local changes
      </button>
      <button
        className="rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() =>
          navigate.toPluginPanel("sync", { subPath: "product-security" })
        }
        type="button"
      >
        Open Sync
      </button>
    </div>
  );
}
