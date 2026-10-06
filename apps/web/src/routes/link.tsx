import { useState, type FormEvent } from "react";
import {
  createFileRoute,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { MAX_PER_ACCOUNT } from "@bb/connect-db";
import appCss from "../styles.css?url";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ClaimField,
  ErrorBox,
  Shell,
  SignInView,
  WebCard,
  claimErrorCopy,
} from "@/components/connect-ui";
import { cn } from "@/lib/utils";
import type {
  LinkApprovalResult,
  LinkApprovalTarget,
  LinkRequestSummary,
  LinkRequestView,
} from "@/server/account";
import type { ServerSummary } from "@/server/api";
import {
  approveLinkFn,
  claimHandleFn,
  denyLinkFn,
  getLinkPageFn,
} from "@/server/fns";

interface LinkSearch {
  code?: string;
}

function validateLinkSearch(search: Record<string, unknown>): LinkSearch {
  const raw = search.code;
  return typeof raw === "string" && raw.trim() !== ""
    ? { code: raw.trim() }
    : {};
}

export const Route = createFileRoute("/link")({
  head: () => ({
    meta: [{ title: "Sign in your bb" }],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  validateSearch: validateLinkSearch,
  loaderDeps: ({ search }) => ({ code: search.code ?? "" }),
  loader: ({ deps }) => getLinkPageFn({ data: { code: deps.code } }),
  component: LinkPage,
});

const BRAND = { title: "bb account", tagline: "Sign in your bb" } as const;

function linkPath(code: string): string {
  return code ? `/link?code=${encodeURIComponent(code)}` : "/link";
}

function hostOf(url: string): string {
  return url.replace(/^https?:\/\//u, "");
}

function decisionErrorCopy(error: string, maxServers: number): string {
  switch (error) {
    case "expired":
      return "This code expired. Run bb account login on your bb to get a new one.";
    case "used":
      return "This code was already used.";
    case "denied":
      return "This request was denied.";
    case "invalid":
      return "This code isn't valid.";
    case "not-found":
      return "That server no longer exists. Pick another.";
    case "confirm-replace":
      return "A bb is now linked to that server. Type the code to replace it.";
    case "code-mismatch":
      return "That code doesn't match this request. Type the code your bb shows.";
    default:
      return claimErrorCopy(error, maxServers);
  }
}

function LinkPage() {
  const data = Route.useLoaderData();
  const search = Route.useSearch();
  const code = search.code ?? "";
  if (!data.authed) {
    return (
      <SignInView
        emailPasswordEnabled={data.emailPasswordEnabled}
        destination={() => linkPath(code)}
        title={BRAND.title}
        tagline={BRAND.tagline}
        description="Sign in to link your bb to your getbb.app account."
      />
    );
  }
  return <LinkView code={code} view={data.view} />;
}

function LinkView({ code, view }: { code: string; view: LinkRequestView }) {
  switch (view.state) {
    case "invalid":
      return <CodeEntry initial={code} invalid={code !== ""} />;
    case "expired":
      return (
        <Notice heading="This code expired">
          Run <code className="font-mono">bb account login</code> on your bb to
          get a new one.
        </Notice>
      );
    case "used":
      return (
        <Notice heading="This code was already used">
          Each code signs in one bb once. Run{" "}
          <code className="font-mono">bb account login</code> again if you need
          a new one.
        </Notice>
      );
    case "denied":
      return (
        <Notice heading="Request denied">
          Your bb was not signed in. You can close this page.
        </Notice>
      );
    case "approved":
      return (
        <Notice heading="Your bb is signed in">
          Return to your bb; it finishes signing in on its own. It will be
          reachable at{" "}
          <code className="font-mono text-foreground">
            {hostOf(view.serverUrl)}
          </code>
          .
        </Notice>
      );
    case "claim-handle":
      return (
        <ClaimHandleStep
          request={view.request}
          suggestedHandle={view.suggestedHandle}
          serverUrlTemplate={view.serverUrlTemplate}
        />
      );
    case "choose-server":
      return <ChooseServerStep view={view} />;
  }
}

function Notice({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <Shell title={BRAND.title} tagline={BRAND.tagline}>
      <WebCard>
        <h3 className="text-base font-semibold tracking-tight">{heading}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{children}</p>
      </WebCard>
    </Shell>
  );
}

function CodeEntry({
  initial,
  invalid,
}: {
  initial: string;
  invalid: boolean;
}) {
  const navigate = useNavigate();
  const [value, setValue] = useState(initial);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const code = value.trim();
    if (code) void navigate({ to: "/link", search: { code } });
  };
  return (
    <Shell title={BRAND.title} tagline={BRAND.tagline}>
      <WebCard>
        <h3 className="text-base font-semibold tracking-tight">
          Enter the code from your bb
        </h3>
        <p className="mt-1 mb-4 text-sm text-muted-foreground">
          Run <code className="font-mono">bb account login</code> on your bb to
          get a code.
        </p>
        <form className="space-y-3" onSubmit={submit}>
          <div className="space-y-1.5">
            <Label htmlFor="link-code">Code</Label>
            <Input
              id="link-code"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              placeholder="ABCD-EFGH"
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          </div>
          {invalid ? <ErrorBox>This code isn&rsquo;t valid.</ErrorBox> : null}
          <Button className="w-full justify-center" type="submit">
            Continue
          </Button>
        </form>
      </WebCard>
    </Shell>
  );
}

function requestedAgo(requestedAt: number): string {
  const mins = Math.floor(Math.max(0, Date.now() - requestedAt) / 60_000);
  if (mins === 0) return "just now";
  return mins === 1 ? "1 minute ago" : `${mins} minutes ago`;
}

function RequestHeader({
  request,
  showCode,
}: {
  request: LinkRequestSummary;
  showCode: boolean;
}) {
  return (
    <>
      <h3 className="text-base font-semibold tracking-tight">
        Sign in <span className="font-mono">{request.clientName}</span>?
      </h3>
      <p
        className="mt-1 text-xs text-subtle-foreground"
        suppressHydrationWarning
      >
        Requested {requestedAgo(request.requestedAt)} from{" "}
        {request.location ?? "an unknown location"}
      </p>
      {showCode ? (
        <>
          <p className="mt-2.5 text-sm text-muted-foreground">
            Check that your bb shows this code:
          </p>
          <p className="mt-2.5 mb-4 rounded-lg border border-dashed border-border bg-surface-recessed px-4 py-3 text-center font-mono text-2xl font-semibold tracking-widest">
            {request.userCode}
          </p>
        </>
      ) : (
        <p className="mt-2.5 mb-4 text-sm text-muted-foreground">
          Only approve a request you started on your own bb.
        </p>
      )}
    </>
  );
}

function DenyButton({ code }: { code: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="outline"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void denyLinkFn({ data: { code } })
          .then(() => router.invalidate())
          .finally(() => setBusy(false));
      }}
    >
      {busy ? "Denying…" : "Deny"}
    </Button>
  );
}

function ClaimHandleStep({
  request,
  suggestedHandle,
  serverUrlTemplate,
}: {
  request: LinkRequestSummary;
  suggestedHandle: string;
  serverUrlTemplate: string;
}) {
  const router = useRouter();
  return (
    <Shell title={BRAND.title} tagline={BRAND.tagline}>
      <WebCard>
        <RequestHeader request={request} showCode />
        <h4 className="text-sm font-semibold">First, pick your address</h4>
        <p className="mt-1 mb-3 text-sm text-muted-foreground">
          Your account gets a permanent address, and your first bb lives there.
        </p>
        <ClaimField
          layout="card"
          serverUrlTemplate={serverUrlTemplate}
          initial={suggestedHandle}
          buildSubmitLabel={(label) =>
            label
              ? `Claim ${hostOf(serverUrlTemplate.replace("{label}", label))}`
              : "Claim your address"
          }
          onClaim={async (label) => {
            const result = await claimHandleFn({ data: label });
            if ("ok" in result) {
              await router.invalidate();
              return null;
            }
            return claimErrorCopy(result.error, MAX_PER_ACCOUNT);
          }}
        />
        <div className="mt-3 flex justify-end">
          <DenyButton code={request.userCode} />
        </div>
      </WebCard>
    </Shell>
  );
}

type ServerChoice = { kind: "existing"; serverId: string } | { kind: "new" };

function defaultChoice(
  servers: ServerSummary[],
  maxServers: number,
): ServerChoice {
  const unlinked = servers.find((server) => !server.connected);
  if (unlinked) return { kind: "existing", serverId: unlinked.id };
  if (servers.length < maxServers || servers.length === 0) {
    return { kind: "new" };
  }
  return { kind: "existing", serverId: servers[0].id };
}

function ChooseServerStep({
  view,
}: {
  view: Extract<LinkRequestView, { state: "choose-server" }>;
}) {
  const router = useRouter();
  const [choice, setChoice] = useState<ServerChoice>(() =>
    defaultChoice(view.servers, view.maxServers),
  );
  const [typedCode, setTypedCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const atCap = view.servers.length >= view.maxServers;
  const code = view.request.userCode;

  async function finish(
    result: LinkApprovalResult | { error: "unauthenticated" },
  ) {
    if ("ok" in result) {
      await router.invalidate();
      return null;
    }
    if (result.error === "unauthenticated") {
      return "Your session ended. Sign in again.";
    }
    if (result.error === "confirm-replace") await router.invalidate();
    return decisionErrorCopy(result.error, view.maxServers);
  }

  const selectedServer =
    choice.kind === "existing"
      ? view.servers.find((server) => server.id === choice.serverId)
      : undefined;
  const replacing = selectedServer?.connected ?? false;

  function approveExisting() {
    if (selectedServer === undefined) return;
    const target: LinkApprovalTarget = replacing
      ? { kind: "replace", serverId: selectedServer.id, typedCode }
      : { kind: "existing", serverId: selectedServer.id };
    setBusy(true);
    setError(null);
    void approveLinkFn({ data: { code, target } })
      .then(finish)
      .then((message) => setError(message))
      .finally(() => setBusy(false));
  }

  return (
    <Shell title={BRAND.title} tagline={BRAND.tagline}>
      <WebCard>
        <RequestHeader request={view.request} showCode={!replacing} />
        <h4 className="text-sm font-semibold">Where should this bb live?</h4>
        <div className="mt-2 flex flex-col gap-1.5" role="radiogroup">
          {view.servers.map((server) => {
            const selected =
              choice.kind === "existing" && choice.serverId === server.id;
            return (
              <ChoiceRow
                key={server.id}
                selected={selected}
                onSelect={() => {
                  setError(null);
                  setChoice({ kind: "existing", serverId: server.id });
                }}
                title={
                  <code className="font-mono">{hostOf(server.serverUrl)}</code>
                }
                detail={
                  server.connected
                    ? "Replace the bb linked here"
                    : "Not linked to a bb yet"
                }
              />
            );
          })}
          <ChoiceRow
            selected={choice.kind === "new"}
            disabled={atCap}
            onSelect={() => {
              setError(null);
              setChoice({ kind: "new" });
            }}
            title="New server"
            detail={
              atCap
                ? `You've reached the limit of ${view.maxServers} bbs.`
                : "Give this bb its own address"
            }
          />
        </div>

        {choice.kind === "new" ? (
          <div className="mt-4">
            <ClaimField
              layout="card"
              serverUrlTemplate={view.serverUrlTemplate}
              initial={view.suggestedLabel}
              previewLead="This bb will live at"
              buildSubmitLabel={(label) =>
                label ? `Approve and claim ${label}` : "Approve"
              }
              onClaim={async (label) =>
                finish(
                  await approveLinkFn({
                    data: { code, target: { kind: "new", label } },
                  }),
                )
              }
            />
          </div>
        ) : (
          <form
            className="mt-4"
            onSubmit={(event) => {
              event.preventDefault();
              approveExisting();
            }}
          >
            {selectedServer !== undefined && replacing ? (
              <>
                <p className="rounded-lg border border-surface-destructive-border bg-surface-destructive px-3 py-2 text-xs text-destructive-text">
                  The bb currently linked to{" "}
                  <b className="font-semibold">
                    {hostOf(selectedServer.serverUrl)}
                  </b>{" "}
                  will be signed out and lose remote access.
                </p>
                <div className="mt-3 space-y-1.5">
                  <Label htmlFor="link-replace-code">
                    Type the code your bb shows
                  </Label>
                  <Input
                    id="link-replace-code"
                    autoCapitalize="characters"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="ABCD-EFGH"
                    value={typedCode}
                    onChange={(event) => {
                      setError(null);
                      setTypedCode(event.target.value);
                    }}
                  />
                </div>
              </>
            ) : null}
            {error ? <ErrorBox>{error}</ErrorBox> : null}
            <Button
              className="mt-3.5 w-full justify-center"
              type="submit"
              disabled={
                busy ||
                selectedServer === undefined ||
                (replacing && typedCode.trim() === "")
              }
            >
              {busy
                ? "Approving…"
                : selectedServer !== undefined && replacing
                  ? `Approve and replace ${hostOf(selectedServer.serverUrl)}`
                  : "Approve"}
            </Button>
          </form>
        )}
        <div className="mt-3 flex justify-end">
          <DenyButton code={code} />
        </div>
      </WebCard>
    </Shell>
  );
}

function ChoiceRow({
  selected,
  disabled,
  onSelect,
  title,
  detail,
}: {
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
  title: React.ReactNode;
  detail: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left hover:bg-state-hover disabled:cursor-not-allowed disabled:opacity-50",
        selected
          ? "border-surface-selected-border bg-surface-selected"
          : "border-border",
      )}
    >
      <span
        className={cn(
          "mt-1 inline-block h-3 w-3 shrink-0 rounded-full border",
          selected ? "border-foreground bg-foreground" : "border-border",
        )}
      />
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">{detail}</span>
      </span>
    </button>
  );
}
