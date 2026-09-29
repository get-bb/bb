import { Link } from "react-router-dom";
import { Button } from "@bb/shared-ui/button";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import { useClipboardCopy } from "@/lib/clipboard";
import { isLocalOnlyUrl } from "@/lib/loopback-hostname";

export function DirectConnectionInstructions() {
  const config = useSystemConfig();
  const configuredUrl = config.data?.serverAccess.effectiveUrl;
  const url =
    configuredUrl && !isLocalOnlyUrl(configuredUrl) ? configuredUrl : null;
  const { copied, copy } = useClipboardCopy({ text: url ?? "" });
  return (
    <div className="space-y-3 text-sm">
      <p className="text-subtle-foreground">
        Enter your server’s URL in the app. Your phone must be able to reach
        this address.
      </p>
      {url ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="min-w-0 break-all font-mono">{url}</span>
          <Button variant="outline" onClick={() => void copy()}>
            {copied ? "Copied" : "Copy URL"}
          </Button>
        </div>
      ) : config.isPending ? (
        <p role="status" className="text-subtle-foreground">
          Loading server address…
        </p>
      ) : config.isError ? (
        <div className="flex flex-wrap items-center gap-3">
          <p role="alert">Could not load the server address.</p>
          <Button variant="outline" onClick={() => void config.refetch()}>
            Try again
          </Button>
        </div>
      ) : (
        <p className="text-subtle-foreground">
          Use a LAN, Tailscale, or public server URL. You can set a shared
          address in{" "}
          <Link
            to="/settings/machines"
            className="underline underline-offset-2"
          >
            Server access
          </Link>
          .
        </p>
      )}
    </div>
  );
}
