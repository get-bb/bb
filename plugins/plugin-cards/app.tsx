import { useEffect, useState, type ReactNode } from "react";
import {
  definePluginApp,
  useBbNavigate,
  useRpc,
  type PluginMessageDirectiveProps,
} from "@get-bb/plugin-sdk/app";
import {
  PluginBrowseCard,
  PluginCatalogAuthorByline,
  PluginCatalogIconChip,
  PluginCatalogInstallControl,
  pluginInstallBadgePresentation,
} from "@/components/ui/plugin-catalog-card";
import { Skeleton } from "@/components/ui/skeleton";
import { DIRECTIVE_ID, PLUGIN_ID_PATTERN } from "./shared.js";
import type { PluginCard, pluginCardsRpcContract } from "./server.js";

type CardState =
  | { status: "loading" }
  | { status: "ready"; card: PluginCard }
  | { status: "not-found" }
  | { status: "error"; message: string };

function CardSlot({ children }: { children: ReactNode }) {
  return <div className="my-2 w-full max-w-xs">{children}</div>;
}

function CardNotice({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="my-2 max-w-md rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground"
    >
      {children}
    </div>
  );
}

function ReadyCard({ card, onOpen }: { card: PluginCard; onOpen: () => void }) {
  const count = pluginInstallBadgePresentation(card.installBadge);
  return (
    <CardSlot>
      <PluginBrowseCard
        leading={<PluginCatalogIconChip entry={card} compact />}
        title={card.displayName}
        description={card.description || undefined}
        byline={
          <PluginCatalogAuthorByline
            name={card.author.name}
            github={card.author.github}
            official={card.author.official}
          >
            {card.author.name}
          </PluginCatalogAuthorByline>
        }
        footerAction={
          card.installed ? (
            <PluginCatalogInstallControl
              displayName={card.displayName}
              installed
              subtle
              included={card.included}
              count={count}
            />
          ) : (
            <PluginCatalogInstallControl
              displayName={card.displayName}
              installed={false}
              subtle
              disabled={!card.compatible}
              unavailableReason={card.incompatibleReason}
              count={count}
              onInstall={onOpen}
            />
          )
        }
        openLabel={`Open ${card.displayName} details`}
        onOpen={onOpen}
      />
    </CardSlot>
  );
}

function PluginCardDirective({ attributes }: PluginMessageDirectiveProps) {
  const rpc = useRpc<typeof pluginCardsRpcContract>();
  const navigate = useBbNavigate();
  const pluginId = attributes.id?.trim() ?? "";
  const validId = PLUGIN_ID_PATTERN.test(pluginId);
  const [state, setState] = useState<CardState>({ status: "loading" });

  useEffect(() => {
    if (!validId) return;
    let cancelled = false;
    rpc.call("getPluginCard", { pluginId }).then(
      (result) => {
        if (cancelled) return;
        setState(
          result.kind === "found"
            ? { status: "ready", card: result.card }
            : { status: "not-found" },
        );
      },
      (error: unknown) => {
        if (cancelled) return;
        setState({
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [pluginId, rpc, validId]);

  if (!validId) {
    return (
      <CardNotice>
        A plugin card needs a plugin id, e.g.{" "}
        <code>{`::${DIRECTIVE_ID}{id="browser-automation"}`}</code>
      </CardNotice>
    );
  }
  if (state.status === "loading") {
    return (
      <CardSlot>
        <div
          role="status"
          aria-busy="true"
          aria-label={`Loading plugin ${pluginId}`}
          className="flex min-h-36 flex-col gap-2 rounded-xl border border-border bg-card p-3"
        >
          <div className="flex items-center gap-3">
            <Skeleton className="size-6 shrink-0 rounded" />
            <Skeleton className="h-4 w-1/3" />
          </div>
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      </CardSlot>
    );
  }
  if (state.status === "not-found") {
    return (
      <CardNotice>
        No installed or store-listed plugin has the id <code>{pluginId}</code>.
      </CardNotice>
    );
  }
  if (state.status === "error") {
    return (
      <div
        role="alert"
        className="my-2 max-w-md rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
      >
        Couldn't load plugin {pluginId}: {state.message}
      </div>
    );
  }
  return (
    <ReadyCard
      card={state.card}
      onOpen={() => navigate.experimental_openPluginDetail(state.card.pluginId)}
    />
  );
}

export default definePluginApp((app) => {
  app.slots.messageDirective({
    id: DIRECTIVE_ID,
    component: (props) => (
      <PluginCardDirective key={props.attributes.id?.trim() ?? ""} {...props} />
    ),
  });
});
