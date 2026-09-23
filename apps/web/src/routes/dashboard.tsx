import { useCallback, useEffect, useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { HugeiconsIcon } from "@hugeicons/react";
import ArrowUpRight01Icon from "@hugeicons/core-free-icons/ArrowUpRight01Icon";
import MoreHorizontalIcon from "@hugeicons/core-free-icons/MoreHorizontalIcon";
import PlusSignIcon from "@hugeicons/core-free-icons/PlusSignIcon";
import { MAX_PER_ACCOUNT } from "@bb/connect-db";
import appCss from "../styles.css?url";
import { Button } from "@/components/ui/button";
import {
  ClaimField,
  Shell,
  SignInView,
  Spinner,
  WebCard,
  claimErrorCopy,
} from "@/components/connect-ui";
import { cn } from "@/lib/utils";
import {
  claimHandleFn,
  createCodeFn,
  createServerRowFn,
  disconnectFn,
  removeServerFn,
  revokeMachineFn,
  getDashboard,
} from "@/server/fns";
import type { IssuedCode, MachineSummary, ServerSummary } from "@/server/api";
import { DASHBOARD_PATH, connectReturnTo } from "@/lib/connect-return-to";
import {
  dashboardRefreshIntervalMs,
  visibleServerPanel,
  type ServerPanel,
} from "@/lib/dashboard-live-state";

interface DashboardSearch {
  returnTo?: string;
}

function validateDashboardSearch(
  search: Record<string, unknown>,
): DashboardSearch {
  const raw = search.returnTo;
  if (
    typeof raw === "string" &&
    raw !== "" &&
    raw !== "null" &&
    raw !== "undefined"
  ) {
    return { returnTo: raw };
  }
  return {};
}

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [{ title: "bb connect" }],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  validateSearch: validateDashboardSearch,
  loader: () => getDashboard(),
  component: Home,
});

type ServerState = Extract<
  ReturnType<typeof Route.useLoaderData>,
  { authed: true }
>;

function StatusDot({ state }: { state: "online" | "offline" | "new" }) {
  return (
    <span
      className={cn(
        "inline-block h-2 w-2 shrink-0 rounded-full",
        state === "online" && "bg-success",
        state === "offline" && "bg-warning",
        state === "new" &&
          "border border-dashed border-subtle-foreground bg-transparent",
      )}
    />
  );
}

function CopyButton({
  text,
  label = "Copy",
  disabled,
}: {
  text: string;
  label?: string;
  disabled?: boolean;
}) {
  const [state, setState] = useState<"idle" | "copied" | "manual">("idle");
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={disabled}
      onClick={() => {
        navigator.clipboard.writeText(text).then(
          () => {
            setState("copied");
            setTimeout(() => setState("idle"), 1400);
          },
          () => {
            setState("manual");
            setTimeout(() => setState("idle"), 2500);
          },
        );
      }}
    >
      {state === "copied" ? "Copied" : state === "manual" ? "Press ⌘C" : label}
    </Button>
  );
}

function BigCode({ code, disabled }: { code: string; disabled?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[10px] border border-dashed border-border bg-surface-recessed px-4 py-3.5">
      <code className="select-all font-mono text-2xl font-semibold tracking-[0.18em]">
        {code}
      </code>
      <CopyButton text={code} disabled={disabled} />
    </div>
  );
}

function Overlay({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-surface-scrim p-4"
      onClick={onClose}
    >
      <div
        className="w-[430px] max-w-full rounded-xl border border-border bg-card p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

function relativeTime(ms: number): string {
  const secs = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function minutes(ms: number): number {
  return Math.max(1, Math.round(ms / 60000));
}

async function signOut() {
  await fetch("/api/auth/sign-out", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  window.location.href = "/dashboard";
}

function Home() {
  const data = Route.useLoaderData();
  const search = Route.useSearch();

  useEffect(() => {
    if (!data.authed) return;
    const returnTo = connectReturnTo(search.returnTo, window.location.origin);
    if (returnTo) window.location.assign(returnTo);
  }, [data.authed, search.returnTo]);

  if (!data.authed)
    return (
      <SignInView
        emailPasswordEnabled={data.emailPasswordEnabled}
        destination={() =>
          connectReturnTo(search.returnTo, window.location.origin) ??
          DASHBOARD_PATH
        }
      />
    );
  if (!data.handle)
    return <ClaimView serverUrlTemplate={data.serverUrlTemplate} />;
  return <AccountDashboard state={data} />;
}

function ClaimView({ serverUrlTemplate }: { serverUrlTemplate: string }) {
  const router = useRouter();
  return (
    <Shell>
      <WebCard>
        <h3 className="text-[17px] font-semibold tracking-tight">
          Pick your address
        </h3>
        <p className="mt-1 mb-4 text-sm text-muted-foreground">
          This becomes your bb&rsquo;s permanent URL. Lowercase letters,
          numbers, and dashes.
        </p>
        <ClaimField
          layout="card"
          serverUrlTemplate={serverUrlTemplate}
          buildSubmitLabel={(l) =>
            l
              ? `Claim ${serverUrlTemplate.replace("{label}", l).replace(/^https?:\/\//u, "")}`
              : "Claim your address"
          }
          onClaim={async (label) => {
            const r = await claimHandleFn({ data: label });
            if ("ok" in r) {
              await router.invalidate();
              return null;
            }
            return claimErrorCopy(r.error, MAX_PER_ACCOUNT);
          }}
        />
      </WebCard>
    </Shell>
  );
}

function SetupCodePanel({
  serverId,
  waitingText,
  compact,
}: {
  serverId: string | undefined;
  waitingText: string;
  compact?: boolean;
}) {
  const [code, setCode] = useState<IssuedCode | null>(null);
  const [showCli, setShowCli] = useState(false);

  const fetchCode = useCallback(async () => {
    const r = await createCodeFn({ data: { serverId, reuse: true } });
    if ("code" in r) setCode(r);
  }, [serverId]);

  useEffect(() => {
    void fetchCode();
  }, [fetchCode]);

  useEffect(() => {
    if (!code) return;
    const t = setTimeout(
      () => void fetchCode(),
      Math.max(1000, code.expiresInMs),
    );
    return () => clearTimeout(t);
  }, [code, fetchCode]);

  const cli = code
    ? `npx -p bb-app@latest bb connect --code ${code.code} --server ${code.serverUrl}`
    : "";

  return (
    <div>
      <BigCode code={code?.code ?? "····–····"} disabled={!code} />
      <p className="mt-2.5 text-xs text-subtle-foreground">
        Paste in{" "}
        <span className="font-medium text-foreground">Plugins → connect</span>{" "}
        on your bb{" · "}
        <button
          className="text-foreground underline underline-offset-2 hover:text-muted-foreground"
          onClick={() => setShowCli((v) => !v)}
        >
          using a terminal?
        </button>
      </p>
      {showCli && code && (
        <div className="mt-2.5 flex flex-col gap-2">
          <pre className="overflow-x-auto whitespace-nowrap rounded-lg border border-border bg-surface-recessed px-3 py-2.5 font-mono text-xs leading-relaxed">
            {cli}
          </pre>
          <div>
            <CopyButton text={cli} label="Copy command" />
          </div>
        </div>
      )}
      <div
        className={cn(
          "mt-4 flex items-center gap-2.5 text-sm text-muted-foreground",
          !compact && "border-t border-border pt-3.5",
        )}
      >
        <Spinner />
        {waitingText}
      </div>
    </div>
  );
}

function RepairCodeBlock({ serverId }: { serverId: string }) {
  const [code, setCode] = useState<IssuedCode | null>(null);
  useEffect(() => {
    void createCodeFn({ data: { serverId, reuse: false } }).then((r) => {
      if ("code" in r) setCode(r);
    });
  }, [serverId]);
  return (
    <div>
      <BigCode code={code?.code ?? "····–····"} disabled={!code} />
      <p className="mt-2.5 text-xs text-subtle-foreground">
        Re-pairing replaces this bb&rsquo;s credential. Paste in{" "}
        <span className="font-medium text-foreground">Plugins → connect</span>
        {code ? ` · expires in ${minutes(code.expiresInMs)} min` : ""}
      </p>
    </div>
  );
}

function ConfirmServerAction({
  server,
  mode,
  onCancel,
}: {
  server: ServerSummary;
  mode: "disconnect" | "remove";
  onCancel: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    if (mode === "remove") {
      await removeServerFn({ data: { serverId: server.id } });
    } else {
      await disconnectFn({ data: { serverId: server.id } });
    }
    await router.invalidate();
    setBusy(false);
    onCancel();
  }
  const removing = mode === "remove";
  return (
    <Overlay onClose={onCancel}>
      <h4 className="mb-1.5 text-[15px] font-semibold">
        {removing ? "Remove this address?" : "Disconnect your bb?"}
      </h4>
      <p className="mb-4 text-sm text-muted-foreground">
        <b className="font-semibold text-foreground">
          {server.serverUrl.replace(/^https?:\/\//, "")}
        </b>{" "}
        {removing
          ? "is freed up and can be claimed again. It was never paired, so nothing stops working."
          : "stops working on all devices immediately. Your bb keeps running locally; re-pairing needs a new connect code."}
      </p>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button variant="destructive" onClick={() => void go()} disabled={busy}>
          {busy
            ? removing
              ? "Removing…"
              : "Disconnecting…"
            : removing
              ? "Remove"
              : "Disconnect"}
        </Button>
      </div>
    </Overlay>
  );
}

function RowMenu({
  items,
}: {
  items: { label: string; danger?: boolean; onSelect: () => void }[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative justify-self-center">
      <button
        className={cn(
          "flex h-[26px] w-[26px] items-center justify-center rounded-md text-subtle-foreground hover:bg-state-hover hover:text-foreground",
          open && "bg-state-hover text-foreground",
        )}
        aria-label="More"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <HugeiconsIcon icon={MoreHorizontalIcon} className="size-4" />
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
            }}
          />
          <div className="absolute right-0 top-8 z-20 min-w-[210px] rounded-[10px] border border-border bg-popover p-1 text-left shadow-lg">
            {items.map((item, i) => (
              <button
                key={i}
                className={cn(
                  "block w-full rounded-md px-2.5 py-2 text-left text-sm hover:bg-state-hover",
                  item.danger &&
                    "text-destructive-text hover:bg-surface-destructive",
                )}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setOpen(false);
                  item.onSelect();
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ServerRow({
  server,
  autoPair,
}: {
  server: ServerSummary;
  autoPair?: boolean;
}) {
  const [panel, setPanel] = useState<ServerPanel>(
    autoPair && !server.connected ? "setup" : "none",
  );
  const [confirm, setConfirm] = useState<"disconnect" | "remove" | null>(null);
  const visiblePanel = visibleServerPanel(server.connected, panel);

  const url = server.serverUrl;
  const copyUrl = () => void navigator.clipboard.writeText(url).catch(() => {});

  const dot = server.online ? "online" : server.connected ? "offline" : "new";
  const menuItems = server.connected
    ? [
        { label: "Copy URL", onSelect: copyUrl },
        {
          label: "Pair again…",
          onSelect: () => setPanel((p) => (p === "repair" ? "none" : "repair")),
        },
        {
          label: "Disconnect…",
          danger: true,
          onSelect: () => setConfirm("disconnect"),
        },
      ]
    : [
        { label: "Copy URL", onSelect: copyUrl },
        ...(server.isPrimary
          ? []
          : [
              {
                label: "Remove…",
                danger: true,
                onSelect: () => setConfirm("remove"),
              },
            ]),
      ];

  const content = (
    <>
      <span className="flex justify-center">
        <StatusDot state={dot} />
      </span>
      <span className="min-w-0">
        <span className="block truncate font-mono text-sm font-medium leading-tight">
          {server.serverUrl.replace(/^https?:\/\//u, "")}
        </span>
        <span className="mt-px block text-xs text-muted-foreground">
          {server.online ? (
            "Online"
          ) : server.connected ? (
            <>
              <span className="text-warning-text">Offline</span>
              {server.lastSeenAt != null
                ? ` · last seen ${relativeTime(server.lastSeenAt)}`
                : ""}
            </>
          ) : (
            <>
              Not set up ·{" "}
              <span className="text-foreground underline underline-offset-2">
                {visiblePanel === "setup" ? "hide code" : "get connect code"}
              </span>
            </>
          )}
        </span>
      </span>
      {server.connected ? (
        <span
          className="justify-self-center text-subtle-foreground"
          aria-hidden
        >
          <HugeiconsIcon icon={ArrowUpRight01Icon} className="size-4" />
        </span>
      ) : (
        <span aria-hidden />
      )}
      <RowMenu items={menuItems} />
    </>
  );

  const rowClass =
    "grid grid-cols-[14px_1fr_26px_26px] items-center gap-2.5 rounded-lg px-2 py-2.5 hover:bg-state-hover";

  return (
    <>
      {server.connected ? (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className={cn(rowClass, "cursor-pointer")}
        >
          {content}
        </a>
      ) : (
        <div
          className={cn(rowClass, "cursor-pointer")}
          role="button"
          tabIndex={0}
          onClick={() => setPanel((p) => (p === "setup" ? "none" : "setup"))}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setPanel((p) => (p === "setup" ? "none" : "setup"));
            }
          }}
        >
          {content}
        </div>
      )}

      {visiblePanel !== "none" && (
        <div className="mb-2 ml-9 mr-2 rounded-[10px] border border-border bg-surface-recessed p-3.5">
          {visiblePanel === "setup" ? (
            <SetupCodePanel
              serverId={server.id}
              compact
              waitingText="Waiting for it to connect… this page updates automatically."
            />
          ) : (
            <RepairCodeBlock serverId={server.id} />
          )}
        </div>
      )}

      {confirm && (
        <ConfirmServerAction
          server={server}
          mode={confirm}
          onCancel={() => setConfirm(null)}
        />
      )}
    </>
  );
}

function ConnectAnotherDialog({
  state,
  onClose,
  onServerCreated,
}: {
  state: ServerState;
  onClose: () => void;
  onServerCreated: (serverId: string) => void;
}) {
  const [server, setServer] = useState<ServerSummary | null>(null);
  const atCap = state.servers.length >= state.maxServers;

  if (atCap && !server) {
    return (
      <Overlay onClose={onClose}>
        <h4 className="mb-1.5 text-[15px] font-semibold">Connect another bb</h4>
        <p className="mb-4 text-sm text-muted-foreground">
          You&rsquo;ve reached the limit of {state.maxServers} bbs on this
          account. Disconnect one to add another.
        </p>
        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </Overlay>
    );
  }

  return (
    <Overlay onClose={onClose}>
      {!server ? (
        <>
          <h4 className="mb-1.5 text-[15px] font-semibold">
            Connect another bb
          </h4>
          <p className="mb-3 text-sm text-muted-foreground">
            Pick its address — every bb gets its own URL.
          </p>
          <ClaimField
            layout="dialog"
            autoFocus
            serverUrlTemplate={state.serverUrlTemplate}
            initial={`${state.handle}-desktop`}
            previewLead="This bb will live at"
            buildSubmitLabel={(l) => `Claim ${l || "…"}`}
            onCancel={onClose}
            onClaim={async (label) => {
              const r = await createServerRowFn({ data: label });
              if ("ok" in r) {
                setServer(r.server);
                onServerCreated(r.server.id);
                return null;
              }
              return claimErrorCopy(r.error, state.maxServers);
            }}
          />
        </>
      ) : (
        <>
          <h4 className="mb-1.5 text-[15px] font-semibold">Pair the new bb</h4>
          <p className="mb-2.5 text-sm text-muted-foreground">
            <code className="font-mono text-xs text-foreground">
              {server.serverUrl.replace(/^https?:\/\//u, "")}
            </code>{" "}
            is reserved for it.
          </p>
          <SetupCodePanel
            serverId={server.id}
            compact
            waitingText="Waiting for it to connect… this dialog closes itself."
          />
          <div className="mt-3.5 flex justify-end">
            <Button variant="outline" onClick={onClose}>
              Do this later
            </Button>
          </div>
        </>
      )}
    </Overlay>
  );
}

function AccountFooter({ state }: { state: ServerState }) {
  const gh = state.githubLogin
    ? `https://github.com/${state.githubLogin}`
    : undefined;
  const cap =
    state.servers.length >= 2
      ? ` · ${state.servers.length} of ${state.maxServers} bbs`
      : "";
  return (
    <div className="mt-3.5 flex items-center justify-between text-xs">
      <button
        className="text-subtle-foreground hover:text-foreground"
        onClick={() => void signOut()}
      >
        Sign out
      </button>
      {gh ? (
        <a
          className="text-subtle-foreground hover:text-foreground"
          href={gh}
          target="_blank"
          rel="noreferrer"
        >
          {state.handle} · GitHub{cap}
        </a>
      ) : (
        <span className="text-subtle-foreground">
          {state.handle} · GitHub{cap}
        </span>
      )}
    </div>
  );
}

function AccountDashboard({ state }: { state: ServerState }) {
  const router = useRouter();
  const [connectOpen, setConnectOpen] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const single = state.servers.length === 1;
  const refreshIntervalMs = dashboardRefreshIntervalMs(
    state.servers,
    pendingId,
  );

  useEffect(() => {
    const id = setInterval(() => void router.invalidate(), refreshIntervalMs);
    return () => clearInterval(id);
  }, [refreshIntervalMs, router]);

  useEffect(() => {
    if (pendingId == null) return;
    if (
      state.servers.find((s: ServerSummary) => s.id === pendingId)?.connected
    ) {
      setConnectOpen(false);
      setPendingId(null);
    }
  }, [state.servers, pendingId]);

  const dialog = connectOpen && (
    <ConnectAnotherDialog
      state={state}
      onClose={() => {
        setConnectOpen(false);
        setPendingId(null);
        void router.invalidate();
      }}
      onServerCreated={(id) => setPendingId(id)}
    />
  );
  const manageServer =
    state.servers.find((server: ServerSummary) => server.online) ??
    state.servers[0] ??
    null;

  async function revoke(machine: MachineSummary) {
    await revokeMachineFn({ data: machine.id });
    await router.invalidate();
  }

  return (
    <Shell top width="md" footer={<AccountFooter state={state} />}>
      {}
      <div className="rounded-xl border border-border bg-card p-2 shadow-sm">
        <div className="flex items-center px-1.5 pb-1.5 pl-3 pt-1.5">
          <h3 className="flex-1 text-[17px] font-semibold tracking-tight">
            Your bbs
          </h3>
          <button
            className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-surface-recessed hover:text-foreground"
            onClick={() => setConnectOpen(true)}
          >
            <HugeiconsIcon icon={PlusSignIcon} className="size-3" />
            Add a bb
          </button>
        </div>
        {state.servers.map((s: ServerSummary) => (
          <ServerRow key={s.id} server={s} autoPair={single} />
        ))}
      </div>
      <div className="mt-3 rounded-xl border border-border bg-card p-2 shadow-sm">
        <div className="flex items-center px-3 pb-1.5 pt-1.5">
          <h3 className="flex-1 text-[15px] font-semibold tracking-tight">
            Machines
          </h3>
          {manageServer !== null ? (
            <a
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-surface-recessed hover:text-foreground"
              href={`${manageServer.serverUrl}/settings/machines`}
            >
              Manage machines in bb
              <HugeiconsIcon icon={ArrowUpRight01Icon} className="size-3" />
            </a>
          ) : null}
        </div>
        {state.machines.length === 0 ? (
          <p className="px-3 pb-2 text-xs text-subtle-foreground">
            Add machines from bb Settings → Machines.
          </p>
        ) : (
          state.machines.map((machine: MachineSummary) => {
            const machineName =
              machine.name ?? `Machine ${machine.id.slice(0, 8)}`;
            return (
              <div
                key={machine.id}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5"
              >
                <StatusDot
                  state={
                    machine.lastSeenAt === null
                      ? "new"
                      : machine.online
                        ? "online"
                        : "offline"
                  }
                />
                <span className="min-w-0 flex-1">
                  {machine.subdomain !== null ? (
                    <span className="block truncate font-mono text-sm font-medium leading-tight">
                      {state.serverUrlTemplate
                        .replace("{label}", machine.subdomain)
                        .replace(/^https?:\/\//u, "")}
                    </span>
                  ) : (
                    <span className="block truncate text-sm font-medium leading-tight">
                      {machineName}
                    </span>
                  )}
                  <span className="mt-px block truncate text-xs text-muted-foreground">
                    {machine.online ? (
                      "Online"
                    ) : machine.lastSeenAt !== null ? (
                      <>
                        <span className="text-warning-text">Offline</span>
                        {` · last seen ${relativeTime(machine.lastSeenAt)}`}
                      </>
                    ) : (
                      "Never connected"
                    )}
                    {machine.subdomain !== null && machine.name !== null
                      ? ` · ${machine.name}`
                      : ""}
                  </span>
                </span>
                <button
                  className="text-xs text-destructive-text hover:underline"
                  onClick={() => void revoke(machine)}
                >
                  Revoke
                </button>
              </div>
            );
          })
        )}
      </div>
      {dialog}
    </Shell>
  );
}
