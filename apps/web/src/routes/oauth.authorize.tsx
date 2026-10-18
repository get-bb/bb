import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import appCss from "../styles.css?url";
import { ErrorBox, Shell, SignInView, WebCard } from "@/components/connect-ui";
import {
  OAUTH_BRAND,
  OAuthConsentBody,
  OAuthErrorBody,
  oauthAuthorizeHref,
  oauthDecisionEffect,
} from "@/components/oauth-consent";
import type { OAuthConsentView } from "@/server/oauth";
import {
  decideOAuthAuthorizationFn,
  getOAuthAuthorizePageFn,
} from "@/server/fns";

const OAUTH_AUTHORIZE_RESPONSE_HEADERS = {
  "content-security-policy": "frame-ancestors 'none'",
  "x-frame-options": "DENY",
  "x-robots-tag": "noindex, nofollow",
  "cache-control": "no-store",
} as const;

export const Route = createFileRoute("/oauth/authorize")({
  head: () => ({
    meta: [
      { title: "Connect an app to your bb" },
      { name: "robots", content: "noindex, nofollow" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  headers: () => OAUTH_AUTHORIZE_RESPONSE_HEADERS,
  loader: () =>
    getOAuthAuthorizePageFn({
      data: {
        browserQuery:
          typeof window === "undefined" ? null : window.location.search,
      },
    }),
  component: OAuthAuthorizePage,
});

function OAuthAuthorizePage() {
  const { query, page } = Route.useLoaderData();
  if (page.kind === "sign-in") {
    return (
      <SignInView
        emailPasswordEnabled={page.emailPasswordEnabled}
        destination={() => oauthAuthorizeHref(query)}
        title={OAUTH_BRAND.title}
        tagline={OAUTH_BRAND.tagline}
        description="Sign in to choose whether this app can use your bb."
      />
    );
  }
  if (page.kind === "error-page") {
    return (
      <OAuthShell>
        <OAuthErrorBody message={page.message} />
      </OAuthShell>
    );
  }
  return <ConsentView query={query} consent={page.consent} />;
}

function OAuthShell({ children }: { children: React.ReactNode }) {
  return (
    <Shell title={OAUTH_BRAND.title} tagline={OAUTH_BRAND.tagline}>
      <WebCard>{children}</WebCard>
    </Shell>
  );
}

function ConsentView({
  query,
  consent,
}: {
  query: string;
  consent: OAuthConsentView;
}) {
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);

  function decide(approved: boolean) {
    setBusy(approved ? "approve" : "deny");
    setError(null);
    void decideOAuthAuthorizationFn({
      data: { query, approved },
    })
      .then((outcome) => {
        const effect = oauthDecisionEffect(outcome);
        if (effect.kind === "leave") {
          window.location.assign(effect.url);
          return;
        }
        setError(effect.message);
        setBusy(null);
      })
      .catch(() => {
        setError("Could not reach getbb.app. Try again.");
        setBusy(null);
      });
  }

  return (
    <OAuthShell>
      <OAuthConsentBody
        consent={consent}
        busy={busy}
        notice={error ? <ErrorBox>{error}</ErrorBox> : null}
        onDecide={decide}
      />
    </OAuthShell>
  );
}
