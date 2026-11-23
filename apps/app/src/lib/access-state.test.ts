// @vitest-environment jsdom

import type { AccessSessionResponse } from "@bb/server-contract";
import { describe, expect, it, vi } from "vitest";
import { getAccessState, watchSessionOnSocketLoss } from "./access-state";

function socketLossSource() {
  const listeners = new Set<() => void>();
  return {
    onSocketLost(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    loseSocket() {
      for (const listener of listeners) listener();
    },
  };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe("watchSessionOnSocketLoss", () => {
  it("checks the session after each lost socket and shows the pairing screen only once the server says this device is signed out", async () => {
    const socket = socketLossSource();
    const signedOut = deferred<AccessSessionResponse>();
    const readSession = vi
      .fn<() => Promise<AccessSessionResponse>>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({
        authenticated: true,
        via: "credential",
        credentialId: "acc_1",
        problem: null,
        requireSignIn: true,
      })
      .mockReturnValueOnce(signedOut.promise);
    watchSessionOnSocketLoss({
      onSocketLost: socket.onSocketLost,
      readSession,
    });

    socket.loseSocket();
    await vi.waitFor(() => expect(readSession).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(getAccessState()).toEqual({ signedIn: true });

    socket.loseSocket();
    await vi.waitFor(() => expect(readSession).toHaveBeenCalledTimes(2));
    await Promise.resolve();
    expect(getAccessState()).toEqual({ signedIn: true });

    await vi.waitFor(() => {
      socket.loseSocket();
      expect(readSession).toHaveBeenCalledTimes(3);
    });
    socket.loseSocket();
    socket.loseSocket();
    expect(readSession).toHaveBeenCalledTimes(3);
    expect(getAccessState()).toEqual({ signedIn: true });

    signedOut.resolve({
      authenticated: false,
      via: null,
      credentialId: null,
      problem: null,
      requireSignIn: true,
    });
    await vi.waitFor(() =>
      expect(getAccessState()).toEqual({
        signedIn: false,
        reason: "unauthenticated",
      }),
    );

    socket.loseSocket();
    expect(readSession).toHaveBeenCalledTimes(3);
  });
});
