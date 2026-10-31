// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { trackLandingEvent } from "./analytics";
import { carryUtmToDownloadLinks } from "./download-utm";
import {
  SendToComputerButton,
  sendDownloadLink,
  sendLinkUrl,
} from "./send-to-computer-button";

vi.mock("./analytics", () => ({ trackLandingEvent: vi.fn() }));

const SHARE_TEXT = "Download bb on your computer";

describe("send download link URL", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    history.replaceState(null, "", "/");
  });

  it("points at the homepage with the page's ad parameters and the share marker", () => {
    expect(
      sendLinkUrl(
        "https://getbb.app/guides/run-agents-in-parallel?ref=x&utm_source=google&utm_medium=cpc&utm_campaign=c1&utm_term=t&utm_content=v&gclid=abc&gbraid=gb&wbraid=wb#step-2",
      ),
    ).toBe(
      "https://getbb.app/?utm_source=google&utm_medium=cpc&utm_campaign=c1&utm_term=t&utm_content=v&gclid=abc&gbraid=gb&wbraid=wb&via=share",
    );
  });

  it("adds only the fixed marker when the page has no ad parameters", () => {
    expect(sendLinkUrl("https://getbb.app/changelog")).toBe(
      "https://getbb.app/?via=share",
    );
    expect(sendLinkUrl("https://getbb.app/?via=elsewhere")).toBe(
      "https://getbb.app/?via=share",
    );
  });

  it("leaves out click IDs already removed for Global Privacy Control", () => {
    vi.stubGlobal("navigator", { globalPrivacyControl: true });
    history.replaceState(null, "", "/?utm_source=google&gclid=abc&wbraid=wb");
    const stop = carryUtmToDownloadLinks();
    stop();
    expect(sendLinkUrl(window.location.href)).toBe(
      `${window.location.origin}/?utm_source=google&via=share`,
    );
  });
});

describe("send download link outcome", () => {
  const url = "https://getbb.app/?via=share";

  it("reports shared once the share sheet resolves", async () => {
    const share = vi.fn(async () => {});
    const copy = vi.fn(async () => true);
    await expect(sendDownloadLink({ url, share, copy })).resolves.toBe(
      "shared",
    );
    expect(share).toHaveBeenCalledWith({
      title: "bb: the IDE that builds itself",
      text: SHARE_TEXT,
      url,
    });
    expect(copy).not.toHaveBeenCalled();
  });

  it("reports cancelled when the share sheet is dismissed", async () => {
    const copy = vi.fn(async () => true);
    await expect(
      sendDownloadLink({
        url,
        share: async () => {
          throw new DOMException("dismissed", "AbortError");
        },
        copy,
      }),
    ).resolves.toBe("cancelled");
    expect(copy).not.toHaveBeenCalled();
  });

  it("copies the link when sharing fails or is unavailable", async () => {
    const copy = vi.fn(async () => true);
    await expect(
      sendDownloadLink({
        url,
        share: async () => {
          throw new DOMException("blocked", "NotAllowedError");
        },
        copy,
      }),
    ).resolves.toBe("copied");
    expect(copy).toHaveBeenCalledWith(url);
    await expect(
      sendDownloadLink({ url, share: undefined, copy: async () => false }),
    ).resolves.toBe("copy_failed");
  });
});

describe("send download link button", () => {
  afterEach(() => {
    vi.mocked(trackLandingEvent).mockClear();
    vi.unstubAllGlobals();
    history.replaceState(null, "", "/");
    document.body.replaceChildren();
  });

  it("renders as a touch-only button with unchanged copy", () => {
    const html = renderToStaticMarkup(
      <SendToComputerButton placement="marketplace" />,
    );
    expect(html).toContain(
      'class="btn btn-primary btn-install install-send touch-only"',
    );
    expect(html).toContain("Send download link");
  });

  it("shares the homepage link and records the click and the result", async () => {
    const share = vi.fn(async () => {});
    vi.stubGlobal("navigator", { share });
    history.replaceState(null, "", "/changelog?utm_source=google&gclid=abc");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<SendToComputerButton placement="changelog" />);
    });
    await act(async () => {
      container.querySelector("button")?.click();
    });
    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({
        text: SHARE_TEXT,
        url: `${window.location.origin}/?utm_source=google&gclid=abc&via=share`,
      }),
    );
    expect(vi.mocked(trackLandingEvent).mock.calls).toEqual([
      [
        {
          name: "landing_send_to_computer_clicked",
          properties: { placement: "changelog" },
        },
      ],
      [
        {
          name: "landing_send_to_computer_result",
          properties: { placement: "changelog", outcome: "shared" },
        },
      ],
    ]);
    act(() => root.unmount());
  });
});
