import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { OAuthConsentView } from "@/server/oauth";
import {
  OAuthConsentBody,
  OAuthErrorBody,
  oauthAuthorizeHref,
  oauthDecisionEffect,
} from "./oauth-consent";

const QUERY =
  "?response_type=code&client_id=https%3A%2F%2Fclaude.ai%2Foauth%2Fclient&state=a%2Bb%3D%3D&scope=bb";

function consentView(overrides: Partial<OAuthConsentView>): OAuthConsentView {
  return {
    clientName: "Claude",
    clientIdHost: "claude.ai",
    redirectHost: "claude.ai",
    loopbackRedirect: false,
    serverHandle: "sawyer",
    serverName: "Sawyer's bb",
    ...overrides,
  };
}

interface ElementProps {
  children?: ReactNode;
  onClick?: () => void;
}

function collectElements(node: ReactNode): ReactElement<ElementProps>[] {
  if (Array.isArray(node)) return node.flatMap(collectElements);
  if (!isValidElement<ElementProps>(node)) return [];
  const rendered =
    typeof node.type === "function"
      ? (node.type as (props: ElementProps) => ReactNode)(node.props)
      : node.props.children;
  return [node, ...collectElements(rendered)];
}

function textOf(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(textOf).join("");
  return "";
}

function consentHarness(consent: OAuthConsentView) {
  const decisions: boolean[] = [];
  const elements = () =>
    collectElements(
      <OAuthConsentBody
        consent={consent}
        busy={null}
        notice={null}
        onDecide={(approved) => {
          decisions.push(approved);
        }}
      />,
    );
  const button = (label: string) => {
    const match = elements().find(
      (element) =>
        element.props.onClick !== undefined &&
        textOf(element.props.children) === label,
    );
    if (match?.props.onClick === undefined) {
      throw new Error(`no ${label} button`);
    }
    return match.props.onClick;
  };
  return {
    decisions,
    click: (label: string) => button(label)(),
  };
}

describe("OAuth consent card", () => {
  it("names the app, its origin, the bb, and the destination", () => {
    const html = renderToStaticMarkup(
      <OAuthConsentBody
        consent={consentView({ redirectHost: "callback.claude.ai" })}
        busy={null}
        notice={null}
        onDecide={() => {}}
      />,
    );
    expect(html).toContain("Let Claude use your bb?");
    expect(html).toContain("claude.ai");
    expect(html).toContain("Sawyer&#x27;s bb");
    expect(html).toContain("sawyer");
    expect(html).toContain("callback.claude.ai");
    expect(html).toContain("threads, projects, environments, diffs");
    expect(html).toContain("run commands and change files");
    expect(html).toContain("Only approve apps you trust.");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("An app on this computer");
  });

  it("adds a caution line when the sign-in goes to an app on this computer", () => {
    const html = renderToStaticMarkup(
      <OAuthConsentBody
        consent={consentView({
          loopbackRedirect: true,
          redirectHost: "127.0.0.1:53211",
        })}
        busy={null}
        notice={null}
        onDecide={() => {}}
      />,
    );
    expect(html).toContain("127.0.0.1:53211");
    expect(html).toContain("An app on this computer will receive this sign-in");
  });

  it("reports the Approve and Deny buttons as their decisions", () => {
    const harness = consentHarness(consentView({}));
    harness.click("Approve");
    harness.click("Deny");
    expect(harness.decisions).toEqual([true, false]);
  });
});

describe("OAuth decision outcome", () => {
  it("leaves the site only for a redirect", () => {
    expect(
      oauthDecisionEffect({
        kind: "redirect",
        url: "https://claude.ai/cb?code=x",
      }),
    ).toEqual({ kind: "leave", url: "https://claude.ai/cb?code=x" });
    expect(
      oauthDecisionEffect({ kind: "error-page", message: "Unknown app." }),
    ).toEqual({ kind: "error", message: "Unknown app." });
    expect(oauthDecisionEffect({ error: "unauthenticated" }).kind).toBe(
      "error",
    );
  });

  it("shows the server's message on the error page", () => {
    const html = renderToStaticMarkup(
      <OAuthErrorBody message="Unknown app." />,
    );
    expect(html).toContain("Unknown app.");
    expect(html).not.toContain("<button");
  });

  it("returns to the same authorization request after sign-in", () => {
    expect(oauthAuthorizeHref(QUERY)).toBe(`/oauth/authorize${QUERY}`);
    expect(oauthAuthorizeHref("")).toBe("/oauth/authorize");
  });
});
