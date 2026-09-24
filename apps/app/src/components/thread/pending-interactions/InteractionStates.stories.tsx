import { useEffect } from "react";
import { installTestPluginRuntime } from "@get-bb/plugin-sdk/testing/app";
import { collectPluginAppRegistrations } from "@/lib/plugin-app-definition";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import {
  setPluginSlotRegistrations,
  removePluginSlotRegistrations,
} from "@/lib/plugin-slots";
import {
  markPluginFrontendsSettled,
  resetPluginFrontendBootStateForTest,
} from "@/lib/plugin-frontend-boot-state";
import {
  resetPluginLogoStoreForTest,
  setPluginLogoUrls,
} from "@/lib/plugin-logos";
import { PluginPendingInteractionComposer } from "@/components/plugin/PluginPendingInteractionComposer";
import { PendingInteractionShell } from "./PendingInteractionShell";
import { ThreadPendingInteractionBanner } from "./ThreadPendingInteractionBanner";
import { StoryCard, StoryRow } from "../../../../.ladle/story-card";
import { loadPluginAppDefinition } from "../../../../.ladle/plugin-app-module";

installTestPluginRuntime();
const secretsApp = await loadPluginAppDefinition(
  import.meta.glob<unknown>("../../../../../../plugins/secrets/app.tsx"),
);

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
    markPluginFrontendsSettled();
    return () => {
      removePluginSlotRegistrations("secrets");
      resetPluginFrontendBootStateForTest();
    };
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
        origin="plugin"
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
        origin="provider"
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

const STORY_ROW_CLASS =
  "grid-cols-1 gap-y-2 px-0 md:grid-cols-[210px_minmax(0,1fr)]";

function PromptStage({ children }: { children: React.ReactNode }) {
  return <div className="w-full max-w-[760px]">{children}</div>;
}

function brandingFor(displayName: string) {
  return {
    displayName,
    icon: null,
    compactIconUrl: null,
    logoUrl: null,
    logoDarkUrl: null,
    icons: new Map<string, string>(),
  };
}

function usePluginBranding(): void {
  useEffect(() => {
    setPluginLogoUrls(
      new Map([
        ["secrets", brandingFor("Secrets")],
        ["ask-user-question", brandingFor("Ask User Question")],
      ]),
    );
    return () => resetPluginLogoStoreForTest();
  }, []);
}

function useSecretsFormRegistered(): void {
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
}

function useSettledPluginFrontends(settled: boolean): void {
  useEffect(() => {
    if (settled) markPluginFrontendsSettled();
    return () => resetPluginFrontendBootStateForTest();
  }, [settled]);
}

const missingRendererRequest = {
  pluginId: "ask-user-question",
  rendererId: "ask-user-question",
  title: "Which eviction policy should the cache use?",
  data: {},
};

const secretsRequest = {
  pluginId: "secrets",
  rendererId: "secret-request",
  title: "Add credentials for the demo service",
  data: {
    purpose: "Connect the demo service",
    destination: { kind: "dotenv", path: "/workspace/.env" },
    fields: [{ name: "DEMO_API_KEY", description: "Service API key" }],
  },
};

function pluginInteraction(id: string) {
  return { id, threadId: "thread-demo", createdAt: 1 };
}

export function PluginFormBooting() {
  usePluginBranding();
  useSecretsFormRegistered();
  useSettledPluginFrontends(false);
  return (
    <StoryCard className="m-0 p-4">
      <StoryRow
        className={STORY_ROW_CLASS}
        label="renderer registered"
        hint="the owning plugin's frontend is already in the slot store, so the form mounts immediately"
      >
        <PromptStage>
          <PluginPendingInteractionComposer
            interaction={pluginInteraction("secrets-booting-demo")}
            origin="plugin"
            request={secretsRequest}
          />
        </PromptStage>
      </StoryRow>
      <StoryRow
        className={STORY_ROW_CLASS}
        label="renderer not in yet"
        hint="plugin frontends are still booting; the card waits instead of claiming the form is unavailable"
      >
        <PromptStage>
          <PluginPendingInteractionComposer
            interaction={pluginInteraction("missing-booting-demo")}
            origin="plugin"
            request={missingRendererRequest}
          />
        </PromptStage>
      </StoryRow>
    </StoryCard>
  );
}

export function PluginFormSettled() {
  usePluginBranding();
  useSecretsFormRegistered();
  useSettledPluginFrontends(true);
  return (
    <StoryCard className="m-0 p-4">
      <StoryRow
        className={STORY_ROW_CLASS}
        label="renderer registered"
        hint="the form the plugin registered, ready to submit"
      >
        <PromptStage>
          <PluginPendingInteractionComposer
            interaction={pluginInteraction("secrets-settled-demo")}
            origin="plugin"
            request={secretsRequest}
          />
        </PromptStage>
      </StoryRow>
      <StoryRow
        className={STORY_ROW_CLASS}
        label="renderer never arrived"
        hint="frontends settled without this renderer, so the host owns the dismissal"
      >
        <PromptStage>
          <PluginPendingInteractionComposer
            interaction={pluginInteraction("missing-settled-demo")}
            origin="plugin"
            request={missingRendererRequest}
          />
        </PromptStage>
      </StoryRow>
      <StoryRow
        className={STORY_ROW_CLASS}
        label="provider-origin request"
        hint="a provider bridge raised the request, so the agent is the asker and backing out stops the turn"
      >
        <PromptStage>
          <PluginPendingInteractionComposer
            interaction={pluginInteraction("bridge-settled-demo")}
            origin="provider"
            request={secretsRequest}
          />
        </PromptStage>
      </StoryRow>
    </StoryCard>
  );
}
