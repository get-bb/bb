import { useCallback, useEffect, useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { HugeiconsIcon } from "@hugeicons/react";
import ArrowUpRight01Icon from "@hugeicons/core-free-icons/ArrowUpRight01Icon";
import PlusSignIcon from "@hugeicons/core-free-icons/PlusSignIcon";
import { MAX_PER_ACCOUNT } from "@bb/connect-db";
import appCss from "../styles.css?url";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ClaimField,
  Overlay,
  RowMenu,
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
  deleteAccountFn,
  disconnectFn,
  removeServerFn,
  revokeMachineFn,
  revokeUnusedDevicesFn,
  listConnectedAppsFn,
  revokeOAuthGrantFn,
  getDashboard,
} from "@/server/fns";
import type { IssuedCode, MachineSummary, ServerSummary } from "@/server/api";
import type { OAuthGrantView } from "@/server/oauth";
import { AppList, DeviceList } from "@/components/dashboard-devices";
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

function DeleteAccountDialog({
  state,
  appCount,
  onClose,
}: {
  state: ServerState;
  appCount: number;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const handle = state.handle ?? "";
  const matches = typed.trim().toLowerCase() === handle;
  const bbs = state.servers.length;
  const devices = state.machines.length;
  const removals = [
    ...(devices > 0
      ? [`${devices} paired ${devices === 1 ? "device" : "devices"}`]
      : []),
    ...(appCount > 0
      ? [`${appCount} connected ${appCount === 1 ? "app" : "apps"}`]
      : []),
  ];

  async function confirm() {
    setBusy(true);
    setFailed(false);
    const result = await deleteAccountFn({
      data: { confirmHandle: typed },
    }).catch(() => null);
    if (result !== null && "ok" in result) {
      window.location.href = "/";
      return;
    }
    setBusy(false);
    setFailed(true);
  }

  return (
    <Overlay onClose={busy ? () => {} : onClose}>
      <h4 className="mb-1.5 text-base font-semibold">
        Delete your bb account?
      </h4>
      <ul className="mb-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
        <li>
          {bbs === 1
            ? "Disconnects your bb. It keeps running on your machine"
            : `Disconnects all ${bbs} of your bbs. They keep running on your machines`}{" "}
          but can&rsquo;t be reached through getbb.app.
        </li>
        {removals.length > 0 && <li>Removes {removals.join(" and ")}.</li>}
        <li>
          Releases <span className="font-mono text-foreground">{handle}</span>
          {bbs === 1
            ? " so anyone can claim it."
            : " and your other addresses so anyone can claim them."}
        </li>
      </ul>
      <p className="mb-4 text-sm text-muted-foreground">
        This can&rsquo;t be undone.
      </p>
      <label className="mb-1.5 block text-xs text-muted-foreground">
        Type your account name,{" "}
        <span className="font-mono text-foreground">{handle}</span>, to confirm
      </label>
      <Input
        autoFocus
        autoComplete="off"
        spellCheck={false}
        value={typed}
        disabled={busy}
        onChange={(e) => setTyped(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && matches && !busy) void confirm();
        }}
      />
      {failed && (
        <p className="mt-2 text-xs text-destructive-text">
          Couldn&rsquo;t delete your account. Try again.
        </p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="destructive"
          disabled={!matches || busy}
          onClick={() => void confirm()}
        >
          {busy ? "Deleting…" : "Delete account"}
        </Button>
      </div>
    </Overlay>
  );
}

function AccountSection({
  state,
  appCount,
}: {
  state: ServerState;
  appCount: number;
}) {
  const [deleting, setDeleting] = useState(false);
  return (
    <>
      <div className="mt-3 rounded-xl border border-border bg-card p-2 shadow-sm">
        <div className="flex items-center gap-3 px-3 py-1.5">
          <span className="min-w-0 flex-1">
            <span className="block text-base font-semibold tracking-tight">
              Account
            </span>
            <span className="mt-px block truncate text-xs text-muted-foreground">
              <span className="font-mono">{state.handle}</span>
              {state.githubLogin ? (
                <>
                  {" · "}
                  <a
                    className="hover:text-foreground"
                    href={`https://github.com/${state.githubLogin}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    GitHub @{state.githubLogin}
                  </a>
                </>
              ) : null}
              {` · ${state.servers.length} of ${state.maxServers} bbs`}
            </span>
          </span>
          <Button variant="outline" size="sm" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
        <div className="px-3 pb-1.5">
          <button
            className="text-xs text-subtle-foreground hover:text-destructive-text"
            onClick={() => setDeleting(true)}
          >
            Delete account…
          </button>
        </div>
      </div>
      {deleting && (
        <DeleteAccountDialog
          state={state}
          appCount={appCount}
          onClose={() => setDeleting(false)}
        />
      )}
    </>
  );
}

function AccountDashboard({ state }: { state: ServerState }) {
  const router = useRouter();
  const [connectOpen, setConnectOpen] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [connectedApps, setConnectedApps] = useState<OAuthGrantView[]>([]);

  useEffect(() => {
    let cancelled = false;
    void listConnectedAppsFn().then((grants) => {
      if (!cancelled) setConnectedApps(grants);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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

  async function removeDevice(device: MachineSummary) {
    await revokeMachineFn({ data: device.id });
    await router.invalidate();
  }

  async function revokeApp(grant: OAuthGrantView) {
    await revokeOAuthGrantFn({ data: grant.id });
    setConnectedApps(await listConnectedAppsFn());
  }

  async function removeUnused() {
    await revokeUnusedDevicesFn();
    await router.invalidate();
  }

  return (
    <Shell top width="md">
      <div className="rounded-xl border border-border bg-card p-2 shadow-sm">
        <div className="flex items-center px-1.5 pb-1.5 pl-3 pt-1.5">
          <h3 className="flex-1 text-base font-semibold tracking-tight">
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
      <DeviceList
        machines={state.machines}
        serverUrlTemplate={state.serverUrlTemplate}
        onRemove={removeDevice}
        onRemoveUnused={removeUnused}
      />
      <AppList grants={connectedApps} onRevoke={revokeApp} />
      <AccountSection state={state} appCount={connectedApps.length} />
      {dialog}
    </Shell>
  );
}
