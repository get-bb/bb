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
  createMachineCodeFn,
  createServerRowFn,
  disconnectFn,
  getDashboard,
} from "@/server/fns";
import type { IssuedCode, MachineSummary, ServerSummary } from "@/server/api";
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

function StatusDot({ state }: { state: "online" | "offline" | "idle" }) {
  return (
    <span
      className={cn(
        "inline-block h-2 w-2 shrink-0 rounded-full",
        state === "online" && "bg-success",
        state === "offline" && "bg-warning",
        state === "idle" && "bg-subtle-foreground",
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

function UrlChip({ url, showOpen }: { url: string; showOpen?: boolean }) {
  return (
    <div className="mt-3 flex items-center gap-1 rounded-[9px] border border-border bg-surface-recessed py-1 pl-3.5 pr-1">
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="min-w-0 flex-1 truncate font-mono text-sm font-medium text-foreground underline-offset-2 hover:underline"
      >
        {url}
      </a>
      <CopyButton text={url} />
      {showOpen && (
        <Button size="sm" asChild>
          <a href={url} target="_blank" rel="noreferrer">
            Open
          </a>
        </Button>
      )}
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

function humanDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
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
  inDialog,
}: {
  serverId: string | undefined;
  waitingText: string;
  inDialog?: boolean;
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
        <button className="text-accent hover:underline" onClick={() => setShowCli((v) => !v)}>
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
          !inDialog && "border-t border-border pt-3.5",
        )}
      >
        <Spinner />
        {waitingText}
      </div>
    </div>
  );
}

/* ── W2b: first-run pair ──────────────────────────────────────────── */

function FirstRunView({ server, baseDomain }: { server: ServerSummary; baseDomain: string }) {
  return (
    <Shell>
      <WebCard>
        <h3 className="text-[17px] font-semibold tracking-tight">Connect your bb</h3>
        <p className="mt-1 mb-4 text-sm text-muted-foreground">
          <code className="font-mono text-xs text-foreground">
            {server.subdomain}.{baseDomain}
          </code>{" "}
          is yours. Pair your machine to bring it online.
        </p>
        <SetupCodePanel
          serverId={server.id}
          waitingText="Waiting for your bb to connect… this page updates automatically."
        />
      </WebCard>
    </Shell>
  );
}

/* ── machines section (hero + multi detail) ───────────────────────── */

function MachineRow({
  online,
  lastSeenAt,
  name,
  meta,
  connected = true,
}: {
  online: boolean;
  lastSeenAt: number | null;
  name: string;
  meta: string;
  connected?: boolean;
}) {
  const status = online
    ? "online"
    : lastSeenAt != null
      ? `last seen ${relativeTime(lastSeenAt)}`
      : connected
        ? "offline"
        : "never connected";
  return (
    <div className="flex items-center gap-2.5 border-b border-border py-2 text-sm last:border-0">
      <StatusDot state={online ? "online" : "idle"} />
      <span className="font-medium">{name}</span>
      <span className="text-xs text-subtle-foreground">{meta}</span>
      <span className="flex-1" />
      <span className="text-xs text-subtle-foreground">{status}</span>
    </div>
  );
}

function MachinesSection({
  server,
  machines,
  appUrl,
}: {
  server: ServerSummary;
  machines: MachineSummary[];
  appUrl: string;
}) {
  const [command, setCommand] = useState<string | null>(null);
  const [show, setShow] = useState(false);

  async function toggle() {
    const next = !show;
    setShow(next);
    if (next && command === null) {
      const r = await createMachineCodeFn({ data: { serverId: server.id } });
      setCommand(
        "code" in r
          ? `curl -fsSL ${appUrl}/connect | sh -s -- machine --code ${r.code} --server ${r.serverUrl}`
          : `# Could not add machine: ${r.error}`,
      );
    }
  }

  return (
    <div className="mt-4 border-t border-border pt-3.5">
      <div className="flex items-center">
        <h5 className="text-[11px] font-semibold uppercase tracking-wide text-subtle-foreground">
          Machines
        </h5>
        <span className="flex-1" />
        <button
          className="text-xs text-muted-foreground hover:text-foreground"
          onClick={() => void toggle()}
        >
          + Add machine
        </button>
      </div>
      <MachineRow
        online={server.online}
        lastSeenAt={server.lastSeenAt}
        name={server.subdomain}
        meta="primary · this bb"
        connected={server.connected}
      />
      {machines.map((m) => (
        <MachineRow
          key={m.id}
          online={m.online}
          lastSeenAt={m.lastSeenAt}
          name={m.name ?? "machine"}
          meta="execution host"
        />
      ))}
      {show && command && (
        <div className="mt-2.5">
          <pre className="overflow-x-auto whitespace-nowrap rounded-lg border border-border bg-surface-recessed px-3 py-2.5 font-mono text-xs leading-relaxed">
            {command}
          </pre>
          <p className="mt-2 text-xs text-subtle-foreground">
            Run on the machine you want to add as an execution host · code expires in 10 min
          </p>
        </div>
      )}
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
    <div className="mt-3.5">
      <BigCode code={code?.code ?? "····–····"} disabled={!code} />
      <p className="mt-2 text-xs text-subtle-foreground">
        Re-pairing replaces this bb&rsquo;s credential. Paste in{" "}
        <span className="font-medium text-foreground">Settings → Remote access</span>
        {code ? ` · expires in ${minutes(code.expiresInMs)} min` : ""}
      </p>
    </div>
  );
}

/* ── disconnect confirm ───────────────────────────────────────────── */

function ConfirmDisconnect({
  server,
  onCancel,
}: {
  server: ServerSummary;
  onCancel: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    await disconnectFn({ data: { serverId: server.id } });
    await router.invalidate();
    setBusy(false);
    onCancel();
  }
  return (
    <Overlay onClose={onCancel}>
      <h4 className="mb-1.5 text-[15px] font-semibold">Disconnect your bb?</h4>
      <p className="mb-4 text-sm text-muted-foreground">
        <b className="font-semibold text-foreground">{server.subdomain}</b> stops working on all
        devices immediately. Your bb keeps running locally; re-pairing needs a new connect code.
      </p>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button variant="destructive" onClick={() => void go()} disabled={busy}>
          {busy ? "Disconnecting…" : "Disconnect"}
        </Button>
      </div>
    </Overlay>
  );
}

/* ── W3: single-bb hero card ──────────────────────────────────────── */

function HeroCard({
  server,
  state,
  onConnectAnother,
}: {
  server: ServerSummary;
  state: ServerState;
  onConnectAnother: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [showRepair, setShowRepair] = useState(false);
  const [confirm, setConfirm] = useState(false);

  return (
    <>
      <WebCard>
        <div className="flex items-center gap-2">
          <h3 className="text-[17px] font-semibold tracking-tight">Your bb</h3>
          <span className="flex-1" />
          {server.online ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-2.5 py-0.5 text-[11px] font-semibold text-success">
              <StatusDot state="online" />
              Online
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-warning/30 bg-warning/10 px-2.5 py-0.5 text-[11px] font-semibold text-warning-text">
              <StatusDot state="offline" />
              Offline
            </span>
          )}
          <div className="relative">
            <button
              className="rounded-md px-2 py-0.5 text-lg leading-none text-muted-foreground hover:bg-state-hover hover:text-foreground"
              aria-label="More"
              onClick={() => setMenuOpen((v) => !v)}
            >
              ···
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-9 z-20 min-w-[210px] rounded-[9px] border border-border bg-popover p-1 shadow-lg">
                  <button
                    className="block w-full rounded-md px-2.5 py-2 text-left text-sm hover:bg-state-hover"
                    onClick={() => {
                      setMenuOpen(false);
                      onConnectAnother();
                    }}
                  >
                    Connect another bb…
                  </button>
                  <div className="mx-1.5 my-1 h-px bg-border" />
                  <button
                    className="block w-full rounded-md px-2.5 py-2 text-left text-sm hover:bg-state-hover"
                    onClick={() => {
                      setMenuOpen(false);
                      setShowRepair((v) => !v);
                    }}
                  >
                    New connect code (re-pair)…
                  </button>
                  <div className="mx-1.5 my-1 h-px bg-border" />
                  <button
                    className="block w-full rounded-md px-2.5 py-2 text-left text-sm text-destructive-text hover:bg-surface-destructive"
                    onClick={() => {
                      setMenuOpen(false);
                      setConfirm(true);
                    }}
                  >
                    Disconnect…
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        <UrlChip url={server.serverUrl} showOpen />

        <p className="mt-2 text-xs text-subtle-foreground">
          Connected since {humanDate(server.createdAt)} · nothing stored in the cloud
        </p>

        {showRepair && <RepairCodeBlock serverId={server.id} />}

        <MachinesSection server={server} machines={state.machines} appUrl={state.appUrl} />
      </WebCard>
      {confirm && <ConfirmDisconnect server={server} onCancel={() => setConfirm(false)} />}
    </>
  );
}

/* ── M1: multi-server row ─────────────────────────────────────────── */

function ServerRow({ server, state }: { server: ServerSummary; state: ServerState }) {
  const [open, setOpen] = useState(false);
  const [showRepair, setShowRepair] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const status = server.online
    ? "online"
    : server.lastSeenAt != null
      ? `last seen ${relativeTime(server.lastSeenAt)}`
      : "never connected";

  return (
    <div className="border-b border-border last:border-0">
      <div
        className="flex cursor-pointer items-center gap-2.5 py-3"
        onClick={() => setOpen((v) => !v)}
      >
        <span
          className={cn(
            "w-3 shrink-0 text-[11px] text-subtle-foreground transition-transform",
            open && "rotate-90",
          )}
        >
          ▶
        </span>
        <StatusDot state={server.online ? "online" : "offline"} />
        <span className="truncate font-mono text-sm font-medium">
          {server.subdomain}
          <span className="text-subtle-foreground">.{state.baseDomain}</span>
        </span>
        {server.isPrimary && (
          <span className="shrink-0 rounded-[5px] border border-border px-1.5 py-px text-[10px] font-semibold text-subtle-foreground">
            primary
          </span>
        )}
        <span className="flex-1" />
        <span className="shrink-0 text-xs text-subtle-foreground">{status}</span>
        <Button
          size="sm"
          disabled={!server.online}
          asChild={server.online}
          onClick={(e) => e.stopPropagation()}
        >
          {server.online ? (
            <a href={server.serverUrl} target="_blank" rel="noreferrer">
              Open
            </a>
          ) : (
            <span>Open</span>
          )}
        </Button>
      </div>

      {open && (
        <div className="pb-4 pl-6">
          <UrlChip url={server.serverUrl} />
          <p className="mt-2 text-xs text-subtle-foreground">
            {server.connected
              ? `Connected since ${humanDate(server.createdAt)} · nothing stored in the cloud`
              : "Not paired yet · nothing stored in the cloud"}
          </p>
          {showRepair && <RepairCodeBlock serverId={server.id} />}
          <MachinesSection server={server} machines={state.machines} appUrl={state.appUrl} />
          <div className="mt-2.5 flex items-center gap-1">
            <button
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setShowRepair((v) => !v)}
            >
              New connect code (re-pair)…
            </button>
            <span className="flex-1" />
            <button
              className="rounded px-1.5 py-1 text-xs text-destructive-text hover:bg-surface-destructive"
              onClick={() => setConfirm(true)}
            >
              Disconnect…
            </button>
          </div>
        </div>
      )}
      {confirm && <ConfirmDisconnect server={server} onCancel={() => setConfirm(false)} />}
    </div>
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
            inDialog
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

/* ── account dashboard (adaptive single / multi) ──────────────────── */

function AccountDashboard({ state }: { state: ServerState }) {
  const router = useRouter();
  const [connectOpen, setConnectOpen] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const sole = state.servers[0];
  const single = state.servers.length <= 1;
  const firstRun = single && (!sole || !sole.connected);
  const waiting = firstRun || (connectOpen && pendingId != null);

  // Poll while waiting on a machine to dial in (first-run or connect-another
  // beat 2); the loader re-runs, and connection flips the view automatically.
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

  // First run: no server has ever paired — the code is the whole page.
  if (firstRun && sole) {
    return <FirstRunView server={sole} baseDomain={state.baseDomain} />;
  }

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

  // Single connected bb: calm hero card.
  if (single && sole) {
    return (
      <Shell top width="md" footer={<AccountFooter state={state} />}>
        <HeroCard server={sole} state={state} onConnectAnother={() => setConnectOpen(true)} />
        {dialog}
      </Shell>
    );
  }

  // Two or more: the row list.
  return (
    <Shell top width="lg" footer={<AccountFooter state={state} />}>
      <WebCard>
        <div className="flex items-center gap-2">
          <h3 className="text-[17px] font-semibold tracking-tight">Your bbs</h3>
          <span className="flex-1" />
          <Button variant="outline" size="sm" onClick={() => setConnectOpen(true)}>
            + Connect another bb
          </Button>
        </div>
        <div className="mt-2 flex flex-col">
          {state.servers.map((s: ServerSummary) => (
            <ServerRow key={s.id} server={s} state={state} />
          ))}
        </div>
      </WebCard>
      {dialog}
    </Shell>
  );
}
