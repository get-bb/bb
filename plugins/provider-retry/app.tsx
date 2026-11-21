import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import {
  definePluginApp,
  experimental_useRpcMutation,
  experimental_useRpcQuery,
  useBbNavigate,
  useComposer,
} from "@get-bb/plugin-sdk/app";
import { handoffContract, type HandoffOffer } from "./src/handoff.js";

function formatRetryAt(retryAt: number): string {
  return new Date(retryAt).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function describeHandoffOffer(offer: HandoffOffer): string {
  if (offer.continuedIn !== null) return `Continued in ${offer.to.name}`;
  return offer.retryAt === null
    ? "No automatic retry"
    : `Retry at ${formatRetryAt(offer.retryAt)}`;
}

function HandoffCard({ threadId }: { threadId: string }) {
  const navigate = useBbNavigate();
  const query = experimental_useRpcQuery({
    contract: handoffContract,
    method: "handoff.get",
    input: { threadId },
  });
  const start = experimental_useRpcMutation({
    contract: handoffContract,
    method: "handoff.start",
  });
  const offer = query.data ?? null;
  if (offer === null) return null;
  const continuedIn = offer.continuedIn;
  return (
    <div
      role="status"
      className="flex min-h-8 items-center gap-1.5 px-3 py-1.5 text-xs"
    >
      <Icon
        name="Clock"
        className="size-3.5 shrink-0 text-warning-text"
        aria-hidden="true"
      />
      <span className="shrink-0 font-medium text-foreground">
        {offer.from.name} usage limit
      </span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        {describeHandoffOffer(offer)}
      </span>
      {continuedIn === null ? (
        <Button
          size="sm"
          variant="outline"
          className="h-6 shrink-0 px-2"
          disabled={start.isPending}
          onClick={() => {
            start
              .mutate({ threadId })
              .then((created) => navigate.toThread(created.threadId))
              .catch((error: unknown) => {
                void query.refetch();
                toast.error(
                  error instanceof Error
                    ? error.message
                    : `Failed to continue in ${offer.to.name}.`,
                );
              });
          }}
        >
          Continue in {offer.to.name}
        </Button>
      ) : (
        <Button
          size="sm"
          variant="outline"
          className="h-6 shrink-0 px-2"
          onClick={() => navigate.toThread(continuedIn)}
        >
          Open thread
        </Button>
      )}
    </div>
  );
}

export function HandoffBanner() {
  const { scope } = useComposer();
  if (scope.kind !== "thread") return null;
  return <HandoffCard key={scope.threadId} threadId={scope.threadId} />;
}

export default definePluginApp((app) => {
  app.composer.customize({
    id: "usage-limit-handoff",
    scopes: ["thread"],
    banners: [{ id: "usage-limit-handoff", component: HandoffBanner }],
  });
});
