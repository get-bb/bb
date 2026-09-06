import { useEffect } from "react";
import { installTestPluginRuntime } from "@get-bb/plugin-sdk/testing/app";
import { collectPluginAppRegistrations } from "@/lib/plugin-app-definition";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import {
  setPluginSlotRegistrations,
  removePluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { PluginPendingInteractionComposer } from "@/components/plugin/PluginPendingInteractionComposer";
import { PendingInteractionShell } from "./PendingInteractionShell";
import { ThreadPendingInteractionBanner } from "./ThreadPendingInteractionBanner";

installTestPluginRuntime();
const { default: secretsApp } =
  await import("../../../../../../plugins/secrets/app");

export default { title: "thread/Pending Interaction/Additional States" };

export function Overview() {
  useEffect(() => {
    setPluginSlotRegistrations(
      "secrets",
      makePluginRegistrationSet({
        pendingInteractions:
          collectPluginAppRegistrations(secretsApp).pendingInteractions,
      }),
    );
    return () => removePluginSlotRegistrations("secrets");
  }, []);
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4">
      <ThreadPendingInteractionBanner
        threadId="thread-demo"
        interaction={{
          id: "plan-demo",
          threadId: "thread-demo",
          turnId: "turn-demo",
          providerId: "codex",
          providerThreadId: "provider-demo",
          providerRequestId: "request-demo",
          status: "pending",
          statusReason: null,
          createdAt: 1,
          resolvedAt: null,
          resolution: null,
          payload: {
            kind: "approval",
            reason: null,
            availableDecisions: ["allow_once", "deny"],
            subject: {
              kind: "plan",
              itemId: "plan-demo",
              plan: "# Share question forms\n\n1. Extract the shared form.\n2. Preserve submission adapters.\n3. Verify mobile and desktop states.",
              planFilePath: "/workspace/plan.md",
            },
          },
        }}
      />
      <PluginPendingInteractionComposer
        interaction={{
          id: "secrets-demo",
          threadId: "thread-demo",
          createdAt: 1,
        }}
        dismissal="cancel"
        request={{
          pluginId: "secrets",
          rendererId: "secret-request",
          title: "Add credentials for the demo service",
          data: {
            purpose: "Connect the demo service",
            destination: { kind: "dotenv", path: "/workspace/.env" },
            fields: [{ name: "DEMO_API_KEY", description: "Service API key" }],
          },
        }}
      />
      <PluginPendingInteractionComposer
        interaction={{
          id: "unavailable-demo",
          threadId: "thread-demo",
          createdAt: 1,
        }}
        dismissal="stop-turn"
        request={{
          pluginId: "unavailable-plugin",
          rendererId: "unavailable",
          title: "Plugin form unavailable",
          data: {},
        }}
      />
      <PendingInteractionShell
        label="Question submission failed"
        initiallyExpanded
        errorMessage="Could not submit your answer. Please try again once the connection is restored."
        testId="error-interaction-shell"
      >
        {() => (
          <p className="text-sm">
            Your draft answer is preserved. Expand the form to review it and
            retry.
          </p>
        )}
      </PendingInteractionShell>
    </div>
  );
}
