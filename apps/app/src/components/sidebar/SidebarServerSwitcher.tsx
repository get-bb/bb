import type { ReactNode } from "react";
import { Icon } from "@bb/shared-ui/icon";
import { ListLoadingPlaceholder } from "@bb/shared-ui/list-loading-placeholder";
import { cn } from "@bb/shared-ui/lib/utils";
import { useServerChoices } from "@/hooks/useServerChoices";
import type { ServerChoice } from "@/lib/server-choices";

const SERVER_KIND_ICON: Record<ServerChoice["kind"], string> = {
  local: "Laptop",
  account: "Cloud",
  custom: "Globe",
};

const ROW_CLASS =
  "flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-sidebar-foreground hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring max-md:pointer-coarse:py-2.5 max-md:pointer-coarse:text-sm";

const ROW_ICON_CLASS = "size-3.5 shrink-0 max-md:pointer-coarse:size-4";

function serverHost(origin: string): string {
  return new URL(origin).host;
}

function focusOnMount(row: HTMLButtonElement | null): void {
  row?.focus({ preventScroll: true });
}

export function SidebarServerSwitcher({ dismiss }: { dismiss(): void }) {
  const choices = useServerChoices();
  if (choices === null) return null;
  const focusedServer =
    choices.servers.find((server) => server.active) ?? choices.servers[0];
  const actions = [
    choices.accountSignIn === null ? null : (
      <ServerAction
        key="sign-in"
        icon="UserRound"
        onClick={() => {
          choices.accountSignIn?.start();
          dismiss();
        }}
      >
        {choices.accountSignIn.label}
      </ServerAction>
    ),
    choices.addServer === null ? null : (
      <ServerAction
        key="add"
        icon="Plus"
        onClick={() => {
          choices.addServer?.();
          dismiss();
        }}
      >
        Add server…
      </ServerAction>
    ),
  ].filter((action) => action !== null);

  return (
    <div className="flex flex-col p-1">
      {choices.status === "loading" ? (
        <ListLoadingPlaceholder label="Loading servers" />
      ) : (
        <ul aria-label="Servers" className="flex flex-col gap-px">
          {choices.servers.map((server) => {
            const host = serverHost(server.origin);
            return (
              <li key={server.id}>
                <button
                  ref={server === focusedServer ? focusOnMount : undefined}
                  type="button"
                  className={ROW_CLASS}
                  title={server.origin}
                  aria-current={server.active ? "true" : undefined}
                  onClick={() => {
                    dismiss();
                    if (!server.active) choices.switchTo(server.id);
                  }}
                >
                  <Icon
                    name={SERVER_KIND_ICON[server.kind]}
                    aria-hidden="true"
                    className={cn(ROW_ICON_CLASS, "text-muted-foreground")}
                  />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{server.name}</span>
                    {host === server.name ? null : (
                      <span className="truncate text-2xs text-subtle-foreground max-md:pointer-coarse:text-xs">
                        {host}
                      </span>
                    )}
                  </span>
                  {server.active ? (
                    <Icon
                      name="Check"
                      aria-label="Current server"
                      className={ROW_ICON_CLASS}
                    />
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {actions.length > 0 ? (
        <div className="mt-1 flex flex-col gap-px border-t border-sidebar-border pt-1">
          {actions}
        </div>
      ) : null}
    </div>
  );
}

function ServerAction({
  icon,
  onClick,
  children,
}: {
  icon: string;
  onClick(): void;
  children: ReactNode;
}) {
  return (
    <button type="button" className={ROW_CLASS} onClick={onClick}>
      <Icon
        name={icon}
        aria-hidden="true"
        className={cn(ROW_ICON_CLASS, "text-muted-foreground")}
      />
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  );
}
