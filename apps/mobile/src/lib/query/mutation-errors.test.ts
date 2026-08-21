import { BbHttpError } from "@bb/sdk/browser";
import { describe, expect, it } from "vitest";
import {
  describeMutationErrorToast,
  getMutationErrorMessage,
  NETWORK_TRANSPORT_ERROR_MESSAGE,
} from "./mutation-errors";

describe("getMutationErrorMessage", () => {
  it("prefers the server error body message over the HTTP status line", () => {
    const error = new BbHttpError({
      status: 409,
      message: "Conflict",
      code: "section_name_conflict",
      body: { message: "Section name already exists." },
    });
    expect(getMutationErrorMessage({ error, fallbackMessage: "Failed." })).toBe(
      "Section name already exists.",
    );
  });

  it("strips the HTTP prefix when the body has no message", () => {
    const error = new BbHttpError({
      status: 500,
      message: "Internal Server Error",
      code: null,
      body: null,
    });
    expect(getMutationErrorMessage({ error, fallbackMessage: "Failed." })).toBe(
      "Internal Server Error",
    );
  });

  it("maps React Native and expo/fetch transport failures to the shared wording", () => {
    for (const message of [
      "Network request failed",
      "fetch failed: UnexpectedException: Could not connect to the server. (at ExpoModulesCore/Promise.swift:56)",
    ]) {
      expect(
        getMutationErrorMessage({
          error: new TypeError(message),
          fallbackMessage: "Failed.",
        }),
      ).toBe(NETWORK_TRANSPORT_ERROR_MESSAGE);
    }
  });

  it("falls back when the error carries no message", () => {
    expect(
      getMutationErrorMessage({ error: {}, fallbackMessage: "Failed." }),
    ).toBe("Failed.");
  });
});

describe("describeMutationErrorToast", () => {
  it("is silent for mutations that opted out and for aborts", () => {
    expect(
      describeMutationErrorToast(new Error("x"), { showErrorToast: false }),
    ).toBeNull();
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    expect(
      describeMutationErrorToast(abort, { errorMessage: "Failed." }),
    ).toBeNull();
  });

  it("uses the meta headline with the server detail as description", () => {
    const error = new BbHttpError({
      status: 400,
      message: "Bad Request",
      code: "invalid",
      body: { message: "Title is too long" },
    });
    expect(
      describeMutationErrorToast(error, {
        errorMessage: "Failed to rename thread.",
      }),
    ).toEqual({
      title: "Failed to rename thread",
      description: "Title is too long",
    });
  });

  it("collapses to one line when only the fallback is known", () => {
    expect(
      describeMutationErrorToast({}, { errorMessage: "Failed to pin thread." }),
    ).toEqual({ title: "Failed to pin thread", description: null });
  });

  it("shows the generic request-failed toast without any meta", () => {
    expect(describeMutationErrorToast({}, undefined)).toEqual({
      title: "Request failed",
      description: "Please try again",
    });
  });
});
