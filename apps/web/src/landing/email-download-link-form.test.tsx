// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { trackLandingEvent } from "./analytics";
import { EmailDownloadLinkForm } from "./email-download-link-form";
import { InstallOptions } from "./landing-visuals";
import { CLI_COMMAND } from "./site";

vi.mock("./analytics", () => ({ trackLandingEvent: vi.fn() }));

let container: HTMLDivElement;
let root: Root;

function render() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(<EmailDownloadLinkForm placement="hero" />);
  });
}

function input(): HTMLInputElement {
  const element = container.querySelector("input");
  if (!element) {
    throw new Error("missing email input");
  }
  return element;
}

function type(value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  act(() => {
    setter?.call(input(), value);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submit() {
  await act(async () => {
    container
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

function eventNames(): string[] {
  return vi.mocked(trackLandingEvent).mock.calls.map(([event]) => event.name);
}

describe("email download link form", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    history.replaceState(null, "", "/?utm_source=google&gclid=abc");
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.mocked(trackLandingEvent).mockClear();
    vi.unstubAllGlobals();
    history.replaceState(null, "", "/");
    document.body.replaceChildren();
  });

  it("flags an invalid address inline without calling the server", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render();
    type("not-an-email");
    await submit();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(input().getAttribute("aria-invalid")).toBe("true");
    expect(container.querySelector("[role=alert]")?.textContent).toBe(
      "Enter a valid email address.",
    );
    expect(eventNames()).toEqual([]);
    type("me@example.com");
    expect(container.querySelector("[role=alert]")).toBeNull();
  });

  it("shows sending, then sent, and records submit and sent", async () => {
    let resolve: (response: Response) => void = () => {};
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render();
    type(" me@example.com ");
    await submit();
    const button = container.querySelector("button");
    expect(button?.textContent).toBe("Sending…");
    expect(button?.disabled).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("/api/email-download-link", {
      body: JSON.stringify({
        email: "me@example.com",
        search: "?utm_source=google&gclid=abc",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    await act(async () => {
      resolve(new Response('{"ok":true}', { status: 200 }));
    });
    expect(container.querySelector("[role=status]")?.textContent).toBe(
      "Check your inbox on your computer",
    );
    expect(vi.mocked(trackLandingEvent).mock.calls).toEqual([
      [
        {
          name: "landing_email_link_submitted",
          properties: { placement: "hero" },
        },
      ],
      [{ name: "landing_email_link_sent", properties: { placement: "hero" } }],
    ]);
  });

  it.each([
    ["not configured", 503, "not_configured"],
    ["a send failure", 502, "send_failed"],
  ] as const)(
    "falls back to the share button on %s",
    async (_name, status, reason) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("{}", { status })),
      );
      render();
      type("me@example.com");
      await submit();
      expect(container.querySelector("input")).toBeNull();
      expect(container.querySelector("[role=alert]")?.textContent).toBe(
        "Couldn’t send the email. Share the link instead.",
      );
      expect(container.querySelector("button")?.textContent).toContain(
        "Send download link",
      );
      expect(vi.mocked(trackLandingEvent)).toHaveBeenCalledWith({
        name: "landing_email_link_failed",
        properties: { placement: "hero", reason },
      });
      expect(eventNames()).not.toContain("landing_email_link_sent");
    },
  );

  it("records a network failure and offers the share fallback", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("offline");
      }),
    );
    render();
    type("me@example.com");
    await submit();
    expect(container.querySelector("button")?.textContent).toContain(
      "Send download link",
    );
    expect(vi.mocked(trackLandingEvent)).toHaveBeenCalledWith({
      name: "landing_email_link_failed",
      properties: { placement: "hero", reason: "network" },
    });
  });

  it("never puts the address in an analytics event", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 400 })),
    );
    render();
    type("me@example.com");
    await submit();
    expect(JSON.stringify(vi.mocked(trackLandingEvent).mock.calls)).not.toMatch(
      /example\.com/,
    );
    expect(input().getAttribute("aria-invalid")).toBe("true");
  });
});

describe("email download link form before hydration", () => {
  it("posts and keeps the button disabled so a native submit can't put the address in a URL", () => {
    const html = renderToStaticMarkup(
      <EmailDownloadLinkForm placement="hero" />,
    );
    expect(html).toContain('method="post"');
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
  });

  it("enables the button once the client handler is attached", () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    render();
    expect(container.querySelector("button")?.disabled).toBe(false);
    act(() => root.unmount());
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });
});

describe("phone email arm placement", () => {
  it("swaps the share button for a touch-only email field and hides the command box from phones", () => {
    const html = renderToStaticMarkup(
      <InstallOptions placement="hero" touchAction="email" />,
    );
    expect(html).toContain('class="subscribe-form install-email touch-only"');
    expect(html).not.toContain("install-send");
    expect(html).toContain(
      'class="btn btn-primary btn-install desktop-only" href="/download/macos?placement=hero"',
    );
    const commandChoice = html.slice(
      html.indexOf('<span class="install-choice desktop-only">'),
    );
    expect(commandChoice).toContain(CLI_COMMAND);
    expect(commandChoice).toContain("Intel Macs");
    expect(html.match(/class="install-choice"/g)).toHaveLength(1);
    expect(html).toContain(
      '<span class="install-note touch-only">We’ll email a link to open on your computer<br/>macOS, Windows, Linux</span>',
    );
  });
});
