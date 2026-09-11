import type { SystemMachineProvider } from "@bb/server-contract";
import modalLogoUrl from "../../../../../../plugins/environment-modal-sandbox/modal-logo.svg?url";
import type { ReactNode } from "react";
import { StoryCard, StoryRow } from "../../../../.ladle/story-card";
import { ThreadMachineStatusBanner } from "./ThreadMachineStatus";

export default {
  title: "promptbox/banner/Machine Status",
};

const noop = () => {};

const modalProvider: SystemMachineProvider = {
  id: "modal-sandbox",
  displayName: "Modal Sandbox",
  description: "Run a machine for development.",
  icon: "./modal-logo.svg",
  logoUrl: modalLogoUrl,
  pluginId: "environment-modal-sandbox",
  inputs: null,
  acceptsEmptyInputs: true,
  supportsSuspend: true,
};

function ResponsiveStage({ children }: { children: ReactNode }) {
  return (
    <div className="flex w-full min-w-0 items-start gap-3 overflow-x-auto">
      <div data-promptbox-shell="" className="min-w-0 flex-1">
        {children}
      </div>
      <div data-promptbox-shell="" className="w-[20rem] shrink-0">
        {children}
      </div>
    </div>
  );
}

function PausedMachine({ hostName }: { hostName: string }) {
  return (
    <ThreadMachineStatusBanner
      provider={modalProvider}
      host={{
        name: hostName,
        type: "ephemeral",
        machineProviderId: modalProvider.id,
      }}
      phase="suspended"
      error={null}
      onResume={noop}
    />
  );
}

export function States() {
  return (
    <StoryCard labelWidth="230px">
      <StoryRow label="paused" hint="Resume is available while paused">
        <ResponsiveStage>
          <PausedMachine hostName="Modal Sandbox" />
        </ResponsiveStage>
      </StoryRow>
      <StoryRow label="pausing" hint="no resume action while pausing">
        <ResponsiveStage>
          <ThreadMachineStatusBanner
            provider={modalProvider}
            host={{
              name: "Modal Sandbox",
              type: "ephemeral",
              machineProviderId: modalProvider.id,
            }}
            phase="suspending"
            error={null}
            onResume={noop}
          />
        </ResponsiveStage>
      </StoryRow>
      <StoryRow label="resuming" hint="the server lifecycle owns this state">
        <ResponsiveStage>
          <ThreadMachineStatusBanner
            provider={modalProvider}
            host={{
              name: "Modal Sandbox",
              type: "ephemeral",
              machineProviderId: modalProvider.id,
            }}
            phase="resuming"
            error={null}
            onResume={noop}
          />
        </ResponsiveStage>
      </StoryRow>
      <StoryRow
        label="resume failed"
        hint="the error stays with the status and offers Retry"
      >
        <ResponsiveStage>
          <ThreadMachineStatusBanner
            provider={modalProvider}
            host={{
              name: "Modal Sandbox",
              type: "ephemeral",
              machineProviderId: modalProvider.id,
            }}
            phase="suspended"
            error="Modal is temporarily unavailable. Your machine is still paused."
            onResume={noop}
          />
        </ResponsiveStage>
      </StoryRow>
      <StoryRow label="long machine name">
        <ResponsiveStage>
          <PausedMachine hostName="Production dashboard development sandbox" />
        </ResponsiveStage>
      </StoryRow>
    </StoryCard>
  );
}
