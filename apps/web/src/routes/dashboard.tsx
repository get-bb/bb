import { useCallback, useEffect, useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { MAX_SERVERS_PER_ACCOUNT } from "@bb/connect-db";
import type { HandleValidationError, LabelAvailability } from "@bb/connect-db";
import appCss from "../styles.css?url";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  checkAvailabilityFn,
  claimHandleFn,
  createCodeFn,
  createServerRowFn,
  disconnectFn,
  removeServerFn,
  getDashboard,
} from "@/server/fns";
import type { IssuedCode, ServerSummary } from "@/server/api";
import bbIcon from "../assets/bb-icon.png";
import { DASHBOARD_PATH, connectReturnTo } from "@/lib/connect-return-to";

interface DashboardSearch {
  returnTo?: string;
}

// Absent means absent: never surface the literal strings "null"/"undefined" (or
// empty) as a return target, and omit the key entirely when there is none so the
// router never re-serializes `?returnTo=null` back into the URL.
function validateDashboardSearch(search: Record<string, unknown>): DashboardSearch {
  const raw = search.returnTo;
  if (typeof raw === "string" && raw !== "" && raw !== "null" && raw !== "undefined") {
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

type ServerState = Extract<ReturnType<typeof Route.useLoaderData>, { authed: true }>;

/* ── layout shell ─────────────────────────────────────────────────── */

function BrandRow() {
  return (
    <div className="mb-[18px] flex items-center gap-2.5">
      <img src={bbIcon} alt="bb" className="h-[30px] w-[30px] rounded-lg" />
      <div className="leading-tight">
        <b className="block text-sm font-semibold">bb connect</b>
        <span className="text-xs text-muted-foreground">Your bb, reachable anywhere</span>
      </div>
    </div>
  );
}

const SHELL_WIDTH = { sm: "max-w-[430px]", md: "max-w-[480px]", lg: "max-w-[530px]" } as const;

function Shell({
  children,
  footer,
  top = false,
  width = "sm",
}: {
  children: React.ReactNode;
  footer?: React.ReactNode;
  top?: boolean;
  width?: keyof typeof SHELL_WIDTH;
}) {
  return (
    <main
      className={cn(
        "mx-auto flex min-h-dvh w-full flex-col px-6 pb-24",
        top ? "justify-start pt-14" : "justify-center pt-16",
      )}
    >
      <div className={cn("mx-auto w-full", SHELL_WIDTH[width])}>
        <BrandRow />
        {children}
        {footer}
      </div>
    </main>
  );
}

function WebCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-xl border border-border bg-card p-5 sm:p-[22px]", className)}>
      {children}
    </div>
  );
}

/* ── small primitives ─────────────────────────────────────────────── */

function StatusDot({ state }: { state: "online" | "offline" | "new" }) {
  return (
    <span
      className={cn(
        "inline-block h-2 w-2 shrink-0 rounded-full",
        state === "online" && "bg-success",
        state === "offline" && "bg-warning",
        state === "new" && "border border-dashed border-subtle-foreground bg-transparent",
      )}
    />
  );
}

function Spinner() {
  return (
    <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-border border-t-subtle-foreground" />
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
        // Copy has a failure path: locked-down / insecure contexts reject the
        // write, so fall back to asking the user to press ⌘C instead of
        // silently doing nothing.
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

function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-2.5 rounded-lg border border-surface-destructive-border bg-surface-destructive px-3 py-2 text-xs text-destructive-text">
      {children}
    </p>
  );
}

function BigCode({ code, disabled }: { code: string; disabled?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[10px] border border-dashed border-border bg-surface-recessed px-4 py-3.5">
      <code className="select-all font-mono text-2xl font-semibold tracking-[0.18em]">{code}</code>
      <CopyButton text={code} disabled={disabled} />
    </div>
  );
}

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
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

function GithubMark() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className="size-4" aria-hidden>
      <path d="M8 .8a7.2 7.2 0 0 0-2.28 14.03c.36.07.5-.15.5-.34l-.01-1.34c-2 .44-2.43-.85-2.43-.85-.32-.83-.8-1.05-.8-1.05-.65-.45.05-.44.05-.44.73.05 1.11.74 1.11.74.65 1.1 1.7.79 2.11.6.07-.47.25-.79.46-.97-1.6-.18-3.28-.8-3.28-3.56 0-.79.28-1.43.74-1.94-.07-.18-.32-.91.07-1.9 0 0 .6-.2 1.98.74a6.9 6.9 0 0 1 3.6 0c1.37-.93 1.97-.74 1.97-.74.4.99.15 1.72.07 1.9.46.5.74 1.15.74 1.94 0 2.77-1.69 3.38-3.3 3.55.26.23.5.67.5 1.35l-.01 2c0 .2.13.42.5.34A7.2 7.2 0 0 0 8 .8z" />
    </svg>
  );
}

/* ── formatting + copy ────────────────────────────────────────────── */

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

function grammarCopy(err: HandleValidationError): string {
  switch (err) {
    case "too-short":
      return "At least 3 characters.";
    case "too-long":
      return "At most 30 characters.";
    case "reserved":
      return "That name is reserved. Pick another.";
    default:
      return "Lowercase letters, numbers, and dashes only.";
  }
}

function availabilityCopy(a: LabelAvailability): string | null {
  if (a.available) return null;
  if (a.reason === "taken") return "That address is already taken. Pick another.";
  return grammarCopy(a.error);
}

function claimErrorCopy(err: string, max: number): string {
  switch (err) {
    case "already-claimed":
      return "You've already claimed an address on this account.";
    case "server-limit":
      return `You've reached the limit of ${max} bbs. Disconnect one to add another.`;
    case "taken":
      return "That address is already taken. Pick another.";
    case "no-handle":
      return "Claim your account address first.";
    case "too-short":
    case "too-long":
    case "reserved":
    case "invalid-format":
      return grammarCopy(err);
    default:
      return "Could not claim that address. Try another.";
  }
}

/* ── auth actions ─────────────────────────────────────────────────── */

async function signInWithGithub(returnTo: string | undefined) {
  const callbackURL = connectReturnTo(returnTo, window.location.origin) ?? DASHBOARD_PATH;
  const res = await fetch("/api/auth/sign-in/social", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "github", callbackURL }),
  });
  const data = (await res.json().catch(() => ({}))) as { url?: string };
  if (data.url) window.location.href = data.url;
}

async function signOut() {
  // better-auth requires the JSON content-type (else 415) and a JSON body
  // (an empty body makes it 500); the browser supplies the Origin it checks.
  await fetch("/api/auth/sign-out", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  window.location.href = "/dashboard";
}

/* ── root ─────────────────────────────────────────────────────────── */

function Home() {
  const data = Route.useLoaderData();
  const search = Route.useSearch();

  useEffect(() => {
    if (!data.authed) return;
    const returnTo = connectReturnTo(search.returnTo, window.location.origin);
    if (returnTo) window.location.assign(returnTo);
  }, [data.authed, search.returnTo]);

  if (!data.authed) return <SignInView returnTo={search.returnTo} />;
  if (!data.handle) return <ClaimView baseDomain={data.baseDomain} />;
  return <AccountDashboard state={data} />;
}

/* ── W1: sign in ──────────────────────────────────────────────────── */

function SignInView({ returnTo }: { returnTo: string | undefined }) {
  return (
    <Shell>
      <WebCard>
        <h3 className="text-[17px] font-semibold tracking-tight">Sign in</h3>
        <p className="mt-1 mb-4 text-sm text-muted-foreground">
          Give your bb a private URL and open it from any browser. Your code and data never leave
          your machine.
        </p>
        <Button
          className="w-full justify-center py-[11px]"
          onClick={() => void signInWithGithub(returnTo)}
        >
          <GithubMark />
          Continue with GitHub
        </Button>
        <p className="mt-3 text-center text-xs text-subtle-foreground">
          Free while in beta · up to {MAX_SERVERS_PER_ACCOUNT} servers per account
        </p>
      </WebCard>
    </Shell>
  );
}

/* ── shared claim field (W2 handle + M2 label) ────────────────────── */

function ClaimField({
  baseDomain,
  initial = "",
  autoFocus,
  previewLead = "Your bb will live at",
  buildSubmitLabel,
  onClaim,
  onCancel,
  cancelLabel = "Cancel",
  layout,
}: {
  baseDomain: string;
  initial?: string;
  autoFocus?: boolean;
  previewLead?: string;
  buildSubmitLabel: (label: string) => string;
  onClaim: (label: string) => Promise<string | null>;
  onCancel?: () => void;
  cancelLabel?: string;
  layout: "card" | "dialog";
}) {
  const [value, setValue] = useState(initial);
  const [avail, setAvail] = useState<LabelAvailability | null>(null);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const label = value.trim().toLowerCase();

  useEffect(() => {
    setSubmitError(null);
    if (!label) {
      setAvail(null);
      return;
    }
    let cancelled = false;
    setAvail(null);
    const t = setTimeout(() => {
      void checkAvailabilityFn({ data: label }).then((r) => {
        if (cancelled) return;
        setAvail("available" in r ? r : null);
      });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [label]);

  const error = submitError ?? (avail ? availabilityCopy(avail) : null);
  const canSubmit = !busy && !!label && (avail?.available ?? false);
  const preview = `https://${label || "you"}.${baseDomain}`;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    const err = await onClaim(label);
    setBusy(false);
    if (err) setSubmitError(err);
  }

  const submitButton = (
    <Button
      disabled={!canSubmit}
      onClick={() => void submit()}
      className={layout === "card" ? "w-full justify-center py-[11px]" : undefined}
    >
      {busy ? "Claiming…" : buildSubmitLabel(label)}
    </Button>
  );

  return (
    <div>
      <div className="flex items-center overflow-hidden rounded-lg border border-border bg-card focus-within:ring-1 focus-within:ring-ring">
        {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
        <input
          value={value}
          autoFocus={autoFocus}
          autoCapitalize="off"
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void submit()}
          className="min-w-0 flex-1 bg-transparent px-3 py-2.5 font-mono text-sm outline-none placeholder:text-subtle-foreground"
          placeholder="your-bb"
          aria-label="Address"
        />
        <span className="pr-3 font-mono text-sm text-subtle-foreground">.{baseDomain}</span>
      </div>
      <p className="mt-2.5 text-xs text-muted-foreground">
        {previewLead} <code className="font-mono text-foreground">{preview}</code>
      </p>
      {error && <ErrorBox>{error}</ErrorBox>}
      {layout === "card" ? (
        <div className="mt-3.5">{submitButton}</div>
      ) : (
        <div className="mt-3.5 flex justify-end gap-2">
          {onCancel && (
            <Button variant="outline" onClick={onCancel}>
              {cancelLabel}
            </Button>
          )}
          {submitButton}
        </div>
      )}
    </div>
  );
}

/* ── W2: claim handle ─────────────────────────────────────────────── */

function ClaimView({ baseDomain }: { baseDomain: string }) {
  const router = useRouter();
  return (
    <Shell>
      <WebCard>
        <h3 className="text-[17px] font-semibold tracking-tight">Pick your address</h3>
        <p className="mt-1 mb-4 text-sm text-muted-foreground">
          This becomes your bb&rsquo;s permanent URL. Lowercase letters, numbers, and dashes.
        </p>
        <ClaimField
          layout="card"
          baseDomain={baseDomain}
          buildSubmitLabel={(l) => (l ? `Claim ${l}.${baseDomain}` : "Claim your address")}
          onClaim={async (label) => {
            const r = await claimHandleFn({ data: label });
            if ("ok" in r) {
              await router.invalidate();
              return null;
            }
            return claimErrorCopy(r.error, MAX_SERVERS_PER_ACCOUNT);
          }}
        />
      </WebCard>
    </Shell>
  );
}

/* ── setup-mode code panel (W2b first-run + M2 beat 2) ────────────── */

function SetupCodePanel({
  serverId,
  waitingText,
  compact,
}: {
  serverId: string | undefined;
  waitingText: string;
  /** Drop the top divider above the waiting line when already inside a box (dialog / inline panel). */
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

  // Re-mint in place when the shown code expires.
  useEffect(() => {
    if (!code) return;
    const t = setTimeout(() => void fetchCode(), Math.max(1000, code.expiresInMs));
    return () => clearTimeout(t);
  }, [code, fetchCode]);

  const cli = code ? `npx -p bb-app@latest bb connect --code ${code.code} --server ${code.serverUrl}` : "";

  return (
    <div>
      <BigCode code={code?.code ?? "····–····"} disabled={!code} />
      <p className="mt-2.5 text-xs text-subtle-foreground">
        Paste in <span className="font-medium text-foreground">Settings → Remote access</span> on
        your bb{" · "}
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

/* ── re-pair code disclosure ──────────────────────────────────────── */

function RepairCodeBlock({ serverId }: { serverId: string }) {
  const [code, setCode] = useState<IssuedCode | null>(null);
  useEffect(() => {
    // "New connect code" always mints fresh (reuse: false).
    void createCodeFn({ data: { serverId, reuse: false } }).then((r) => {
      if ("code" in r) setCode(r);
    });
  }, [serverId]);
  return (
    <div>
      <BigCode code={code?.code ?? "····–····"} disabled={!code} />
      <p className="mt-2.5 text-xs text-subtle-foreground">
        Re-pairing replaces this bb&rsquo;s credential. Paste in{" "}
        <span className="font-medium text-foreground">Settings → Remote access</span>
        {code ? ` · expires in ${minutes(code.expiresInMs)} min` : ""}
      </p>
    </div>
  );
}

/* ── disconnect / remove confirm ──────────────────────────────────── */

function ConfirmServerAction({
  server,
  mode,
  onCancel,
}: {
  server: ServerSummary;
  /** "disconnect" revokes a live credential (row survives); "remove" deletes a never-paired row. */
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
        <b className="font-semibold text-foreground">{server.serverUrl.replace(/^https?:\/\//, "")}</b>{" "}
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

/* ── row overflow menu ────────────────────────────────────────────── */

function RowMenu({ items }: { items: { label: string; danger?: boolean; onSelect: () => void }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative justify-self-center">
      <button
        className={cn(
          "flex h-[26px] w-[26px] items-center justify-center rounded-md text-lg leading-none text-subtle-foreground hover:bg-state-hover hover:text-foreground",
          open && "bg-state-hover text-foreground",
        )}
        aria-label="More"
        onClick={(e) => {
          // The row is a link / click target; keep the button's own click from
          // navigating or toggling the row's panel.
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        ⋯
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
                  item.danger && "text-destructive-text hover:bg-surface-destructive",
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

/* ── server row — one row per bb, the row is the link ─────────────── */

function ServerRow({
  server,
  baseDomain,
  autoPair,
}: {
  server: ServerSummary;
  baseDomain: string;
  /** First-run: the sole never-paired bb opens its pair panel by default. */
  autoPair?: boolean;
}) {
  // A connected row toggles the re-pair panel; a never-paired row toggles its
  // setup panel. `panel` tracks which (if any) is showing under this row.
  const [panel, setPanel] = useState<"none" | "setup" | "repair">(
    autoPair && !server.connected ? "setup" : "none",
  );
  const [confirm, setConfirm] = useState<"disconnect" | "remove" | null>(null);

  const url = server.serverUrl;
  const copyUrl = () => void navigator.clipboard.writeText(url).catch(() => {});

  const dot = server.online ? "online" : server.connected ? "offline" : "new";
  const menuItems = server.connected
    ? [
        { label: "Copy URL", onSelect: copyUrl },
        {
          label: "New connect code (re-pair)…",
          onSelect: () => setPanel((p) => (p === "repair" ? "none" : "repair")),
        },
        { label: "Disconnect…", danger: true, onSelect: () => setConfirm("disconnect") },
      ]
    : [
        { label: "Copy URL", onSelect: copyUrl },
        // The primary bb (subdomain === handle) is the account's identity and
        // can't be removed; only never-paired secondaries offer Remove.
        ...(server.isPrimary
          ? []
          : [{ label: "Remove…", danger: true, onSelect: () => setConfirm("remove") }]),
      ];

  const content = (
    <>
      <span className="flex justify-center">
        <StatusDot state={dot} />
      </span>
      <span className="min-w-0">
        <span className="block truncate font-mono text-sm font-medium leading-tight">
          {server.subdomain}
          <span className="font-normal text-subtle-foreground">.{baseDomain}</span>
        </span>
        <span className="mt-px block text-xs text-muted-foreground">
          {server.online ? (
            "Online"
          ) : server.connected ? (
            <>
              <span className="text-warning-text">Offline</span>
              {server.lastSeenAt != null ? ` · last seen ${relativeTime(server.lastSeenAt)}` : ""}
            </>
          ) : (
            <>
              Not set up ·{" "}
              <span className="text-foreground underline underline-offset-2">
                {panel === "setup" ? "hide code" : "get connect code"}
              </span>
            </>
          )}
        </span>
      </span>
      {server.connected ? (
        <span className="justify-self-center text-subtle-foreground" aria-hidden>
          ↗
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
        <a href={url} target="_blank" rel="noreferrer" className={cn(rowClass, "cursor-pointer")}>
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

      {panel !== "none" && (
        <div className="mb-2 ml-9 mr-2 rounded-[10px] border border-border bg-surface-recessed p-3.5">
          {panel === "setup" ? (
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
        <ConfirmServerAction server={server} mode={confirm} onCancel={() => setConfirm(null)} />
      )}
    </>
  );
}

/* ── M2: connect another bb dialog ────────────────────────────────── */

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
          You&rsquo;ve reached the limit of {state.maxServers} bbs on this account. Disconnect one to
          add another.
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
          <h4 className="mb-1.5 text-[15px] font-semibold">Connect another bb</h4>
          <p className="mb-3 text-sm text-muted-foreground">
            Pick its address — every bb gets its own URL.
          </p>
          <ClaimField
            layout="dialog"
            autoFocus
            baseDomain={state.baseDomain}
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
              {server.subdomain}.{state.baseDomain}
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

/* ── footer ───────────────────────────────────────────────────────── */

function AccountFooter({ state }: { state: ServerState }) {
  const gh = state.githubLogin ? `https://github.com/${state.githubLogin}` : undefined;
  const cap = state.servers.length >= 2 ? ` · ${state.servers.length} of ${state.maxServers} bbs` : "";
  return (
    <div className="mt-3.5 flex items-center justify-between text-xs">
      <button className="text-subtle-foreground hover:text-foreground" onClick={() => void signOut()}>
        Sign out
      </button>
      {gh ? (
        <a className="text-subtle-foreground hover:text-foreground" href={gh} target="_blank" rel="noreferrer">
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

/* ── account dashboard — one list for 1..N bbs ────────────────────── */

function AccountDashboard({ state }: { state: ServerState }) {
  const router = useRouter();
  const [connectOpen, setConnectOpen] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const single = state.servers.length === 1;
  // Poll whenever any bb is still unpaired (first run, or a just-claimed row
  // waiting for its machine) so the row flips to Online without a manual reload.
  const waiting =
    state.servers.some((s: ServerSummary) => !s.connected) || (connectOpen && pendingId != null);

  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(() => void router.invalidate(), 3000);
    return () => clearInterval(id);
  }, [waiting, router]);

  // Self-close the connect dialog once the new server pairs.
  useEffect(() => {
    if (pendingId == null) return;
    if (state.servers.find((s: ServerSummary) => s.id === pendingId)?.connected) {
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
        // A claim may have created a still-offline row; refetch so the list
        // reflects it (e.g. after "Do this later").
        void router.invalidate();
      }}
      onServerCreated={(id) => setPendingId(id)}
    />
  );

  return (
    <Shell top width="md" footer={<AccountFooter state={state} />}>
      {/* Tight padding so each row is a full-bleed, rounded hover target. */}
      <div className="rounded-xl border border-border bg-card p-2 shadow-sm">
        <div className="flex items-center px-1.5 pb-1.5 pl-3 pt-1.5">
          <h3 className="flex-1 text-[17px] font-semibold tracking-tight">Your bbs</h3>
          <button
            className="rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-surface-recessed hover:text-foreground"
            onClick={() => setConnectOpen(true)}
          >
            + Add a bb
          </button>
        </div>
        {state.servers.map((s: ServerSummary) => (
          <ServerRow key={s.id} server={s} baseDomain={state.baseDomain} autoPair={single} />
        ))}
      </div>
      {dialog}
    </Shell>
  );
}
