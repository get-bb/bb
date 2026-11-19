// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useQuery } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sdk } from "@/lib/sdk";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { AccessGate } from "./AccessGate";
import { PairingScreen } from "./PairingScreen";

interface RecordedRequest {
  path: string;
  body: string;
}

function stubServer(): RecordedRequest[] {
  const requests: RecordedRequest[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request =
        input instanceof Request
          ? input
          : new Request(new URL(String(input), "http://bb.test"), init);
      const path = new URL(request.url).pathname;
      requests.push({ path, body: await request.text() });
      if (path === "/api/v1/access/pairings/redeem") {
        return Response.json(
          {
            code: "invalid_pairing_code",
            message: "That pairing code is wrong, expired or already used.",
          },
          { status: 401 },
        );
      }
      return Response.json(
        { code: "unauthenticated", message: "Sign in to this bb first." },
        { status: 401 },
      );
    }),
  );
  return requests;
}

function SignedInApp() {
  useQuery({
    queryKey: ["access-gate-test"],
    queryFn: () => sdk.experimental_access.listCredentials(),
  });
  return <p>app content</p>;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("AccessGate", () => {
  it("drops to the pairing screen when the server refuses a request, and a wrong code keeps it there", async () => {
    stubServer();
    const { wrapper } = createQueryClientTestHarness();
    render(
      <AccessGate>
        <SignedInApp />
      </AccessGate>,
      { wrapper },
    );
    expect(screen.getByText("app content")).toBeTruthy();

    await screen.findByRole("heading", { name: "Sign in to this bb" });
    expect(screen.queryByText("app content")).toBeNull();

    const input = screen.getByPlaceholderText("XXXXX-XXXXX");
    fireEvent.change(input, { target: { value: "abcde fghjk" } });
    expect((input as HTMLInputElement).value).toBe("ABCDE-FGHJK");
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "That code is wrong",
    );
    expect(
      screen.getByRole("heading", { name: "Sign in to this bb" }),
    ).toBeTruthy();
  });
});

describe("PairingScreen", () => {
  it("redeems the code from a pairing link once and strips it from the address", async () => {
    const requests = stubServer();
    window.history.replaceState(null, "", "/pair#code=abcde-fghjk");
    const { wrapper } = createQueryClientTestHarness();
    render(<PairingScreen reason="unauthenticated" />, { wrapper });

    await waitFor(() =>
      expect(
        requests.filter(
          (request) => request.path === "/api/v1/access/pairings/redeem",
        ),
      ).toEqual([
        {
          path: "/api/v1/access/pairings/redeem",
          body: JSON.stringify({ kind: "browser", code: "ABCDE-FGHJK" }),
        },
      ]),
    );
    expect(window.location.hash).toBe("");
    expect(window.location.pathname).toBe("/pair");
    await screen.findByRole("alert");
  });
});
