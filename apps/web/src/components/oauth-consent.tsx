import { Button } from "@/components/ui/button";
import type { OAuthConsentView } from "@/server/oauth";

export const OAUTH_BRAND = {
  title: "bb account",
  tagline: "Connect an app to your bb",
} as const;

export const OAUTH_AUTHORIZE_PATH = "/oauth/authorize";

export function oauthAuthorizeHref(query: string): string {
  return `${OAUTH_AUTHORIZE_PATH}${query}`;
}

export type OAuthDecisionOutcome =
  | { kind: "redirect"; url: string }
  | { kind: "error-page"; message: string }
  | { error: "unauthenticated" };

export type OAuthDecisionEffect =
  | { kind: "leave"; url: string }
  | { kind: "error"; message: string };

export function oauthDecisionEffect(
  outcome: OAuthDecisionOutcome,
): OAuthDecisionEffect {
  if ("error" in outcome) {
    return {
      kind: "error",
      message: "Your session ended. Reload this page and sign in again.",
    };
  }
  if (outcome.kind === "redirect") return { kind: "leave", url: outcome.url };
  return { kind: "error", message: outcome.message };
}

export function OAuthErrorBody({ message }: { message: string }) {
  return (
    <>
      <h3 className="text-base font-semibold tracking-tight">
        This app can&rsquo;t be connected
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">
        The app sent a sign-in request that bb can&rsquo;t accept. This is a
        problem with the app, not with your account. Nothing was shared, and you
        can close this page.
      </p>
      <p className="mt-2.5 text-xs text-subtle-foreground">
        Reason: <span className="font-mono">{message}</span>
      </p>
    </>
  );
}

function Fact({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-3 px-3 py-2">
      <dt className="w-24 shrink-0 text-xs text-subtle-foreground">{label}</dt>
      <dd className="min-w-0 flex-1 text-sm break-words">{children}</dd>
    </div>
  );
}

export function OAuthConsentBody({
  consent,
  busy,
  notice,
  onDecide,
}: {
  consent: OAuthConsentView;
  busy: "approve" | "deny" | null;
  notice: React.ReactNode;
  onDecide: (approved: boolean) => void;
}) {
  return (
    <>
      <h3 className="text-base font-semibold tracking-tight">
        Let {consent.clientName} use your bb?
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Only approve this if you just asked {consent.clientName} to connect to
        your bb.
      </p>
      <dl className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface-recessed">
        <Fact label="App">
          <span className="font-medium">{consent.clientName}</span>
          <span className="block text-xs text-muted-foreground">
            from <code className="font-mono">{consent.clientIdHost}</code>
          </span>
        </Fact>
        <Fact label="Your bb">
          <span className="font-medium">{consent.serverName}</span>
          <span className="block text-xs text-muted-foreground">
            <code className="font-mono">{consent.serverHandle}</code>
          </span>
        </Fact>
        <Fact label="Afterwards">
          You&rsquo;ll be sent to{" "}
          <code className="font-mono">{consent.redirectHost}</code>
        </Fact>
      </dl>
      {consent.loopbackRedirect ? (
        <p className="mt-2.5 rounded-lg border border-border px-3 py-2 text-xs text-warning-text">
          An app on this computer will receive this sign-in. Only continue if
          you just started this from an app on this device.
        </p>
      ) : null}
      <h4 className="mt-4 text-sm font-semibold">What approving allows</h4>
      <p className="mt-1 text-sm text-muted-foreground">
        {consent.clientName} can see everything in this bb: threads, projects,
        environments, diffs, and settings. It can also start and steer agents,
        which run commands and change files on the machines this bb controls.
        Only approve apps you trust.
      </p>
      {notice}
      <div className="mt-4 flex justify-end gap-2">
        <Button
          variant="outline"
          disabled={busy !== null}
          onClick={() => onDecide(false)}
        >
          {busy === "deny" ? "Denying…" : "Deny"}
        </Button>
        <Button disabled={busy !== null} onClick={() => onDecide(true)}>
          {busy === "approve" ? "Approving…" : "Approve"}
        </Button>
      </div>
      <p className="mt-3 text-xs text-subtle-foreground">
        You can disconnect this app at any time from your bb account page.
      </p>
    </>
  );
}
