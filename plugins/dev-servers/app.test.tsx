// @vitest-environment jsdom

import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";
import { DevServersDetails, serverUrl, summaryLabel } from "./app.js";
import { devServersContract, type HostDevServer } from "./contract.js";

const THREAD_ID = "thr_dev";

function server(overrides: Partial<HostDevServer> = {}): HostDevServer {
  return {
    threadId: THREAD_ID,
    rootPid: 140,
    startedAt: 1,
    command: "npm run dev",
    cwd: "/work/app",
    ports: [{ port: 5173, address: "127.0.0.1" }],
    hostId: "host_1",
    hostName: "laptop",
    primaryHost: true,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

function renderDetails(servers: HostDevServer[]) {
  return renderSlot(
    { component: DevServersDetails },
    {
      threadId: THREAD_ID,
      projectId: "proj_1",
      environment: null,
      segments: [],
      isExpanded: true,
      onToggle: () => {},
    },
    {
      experimental_rpcContract: devServersContract,
      rpc: {
        "servers.list": () => ({ status: "ok" as const, servers }),
        "servers.stop": () => ({ stopped: true }),
      },
    },
  );
}

describe("dev servers segment", () => {
  it("summarizes the servers and their first ports", () => {
    expect(summaryLabel([server()])).toBe("1 server · :5173");
    expect(
      summaryLabel([
        server({
          ports: [
            { port: 3000, address: "::1" },
            { port: 3001, address: "::1" },
          ],
        }),
        server({
          rootPid: 200,
          ports: [
            { port: 8080, address: "0.0.0.0" },
            { port: 9000, address: "0.0.0.0" },
          ],
        }),
      ]),
    ).toBe("2 servers · :3000 :3001 :8080 +1");
  });

  it("opens a server on this machine and stops it through the plugin", async () => {
    const slot = renderDetails([server()]);

    fireEvent.click(
      await screen.findByRole("button", { name: "Open http://localhost:5173" }),
    );
    expect(slot.inspection.navigateCalls).toMatchObject([
      { method: "openUrl", url: "http://localhost:5173" },
    ]);
    fireEvent.click(
      screen.getByRole("button", { name: "Stop the server on :5173" }),
    );
    await expect
      .poll(() =>
        slot.inspection.rpcCalls.find((call) => call.method === "servers.stop"),
      )
      .toMatchObject({
        input: { threadId: THREAD_ID, rootPid: 140, startedAt: 1 },
      });
  });

  it("names the machine instead of opening a server on another one", async () => {
    renderDetails([server({ primaryHost: false, hostName: "build-box" })]);

    expect(await screen.findByText("build-box")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /^Open / })).toBeNull();
  });

  it("offers Open only to a client on the server's machine", () => {
    expect(serverUrl(server(), "localhost")).toBe("http://localhost:5173");
    expect(serverUrl(server(), "127.0.0.1")).toBe("http://localhost:5173");
    expect(serverUrl(server(), "bb.example.com")).toBeNull();
    expect(serverUrl(server({ primaryHost: false }), "localhost")).toBeNull();
  });
});
