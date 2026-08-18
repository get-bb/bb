import { describe, expect, it } from "vitest";
import { normalizePendingInteractionRequestedPermissionProfile } from "./pending-interaction-normalization.js";

describe("pending interaction normalization", () => {
  it("normalizes requested permission profiles to explicit nulls and arrays", () => {
    expect(
      normalizePendingInteractionRequestedPermissionProfile({
        network: {
          enabled: undefined,
        },
        fileSystem: {
          read: null,
          write: undefined,
        },
        macos: {
          preferences: "read_only",
          automations: {
            bundleIds: ["com.apple.finder"],
          },
          launchServices: true,
          accessibility: undefined,
          calendar: false,
          reminders: null,
          contacts: "read_only",
        },
      }),
    ).toEqual({
      network: {
        enabled: null,
      },
      fileSystem: {
        read: [],
        write: [],
      },
      macos: {
        preferences: "read_only",
        automations: {
          kind: "bundle_ids",
          bundleIds: ["com.apple.finder"],
        },
        launchServices: true,
        accessibility: false,
        calendar: false,
        reminders: false,
        contacts: "read_only",
      },
    });
  });

  it("keeps explicit macOS nulls and automation literals during normalization", () => {
    expect(
      normalizePendingInteractionRequestedPermissionProfile({
        network: null,
        fileSystem: null,
        macos: null,
      }),
    ).toEqual({
      network: null,
      fileSystem: null,
      macos: null,
    });

    expect(
      normalizePendingInteractionRequestedPermissionProfile({
        network: null,
        fileSystem: null,
        macos: {
          preferences: null,
          automations: "none",
          launchServices: null,
          accessibility: null,
          calendar: null,
          reminders: null,
          contacts: null,
        },
      }).macos,
    ).toMatchObject({
      automations: "none",
    });

    expect(
      normalizePendingInteractionRequestedPermissionProfile({
        network: null,
        fileSystem: null,
        macos: {
          preferences: null,
          automations: "all",
          launchServices: null,
          accessibility: null,
          calendar: null,
          reminders: null,
          contacts: null,
        },
      }).macos,
    ).toMatchObject({
      automations: "all",
    });

    expect(
      normalizePendingInteractionRequestedPermissionProfile({
        network: null,
        fileSystem: null,
        macos: {
          preferences: null,
          automations: null,
          launchServices: null,
          accessibility: null,
          calendar: null,
          reminders: null,
          contacts: null,
        },
      }).macos,
    ).toMatchObject({
      automations: "none",
    });

    expect(
      normalizePendingInteractionRequestedPermissionProfile({
        network: null,
        fileSystem: null,
        macos: {
          preferences: null,
          automations: undefined,
          launchServices: null,
          accessibility: null,
          calendar: null,
          reminders: null,
          contacts: null,
        },
      }).macos,
    ).toMatchObject({
      automations: "none",
    });
  });
});
