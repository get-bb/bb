import { useState } from "react";
import type { SetupJobArm, SetupJobOffer } from "@bb/server-contract";
import { DevicesStep, OnboardingLayout } from "./OnboardingViews";
import { SetupJobCheckbox } from "./SetupJobCheckbox";

export default { title: "onboarding/Setup job" };

const noop = () => {};

function SetupJobStory({ arm }: { arm: SetupJobArm }) {
  const [checked, setChecked] = useState(false);
  const [finished, setFinished] = useState(false);
  const offer: SetupJobOffer = {
    arm,
    suggestionAnalyticsId: "26ad88d4-6506-4ba9-a0ed-ccac606c638c",
    title:
      arm === "a"
        ? "Each weeknight, keep going on unfinished work"
        : "Each weeknight, fix what's failing on main",
    projectId: "example-project",
    projectName: "My project",
    providerName: "My agent",
    timezone: "America/Los_Angeles",
    status: "offered",
    automationId: null,
  };
  return (
    <div className="flex h-dvh flex-col">
      <OnboardingLayout
        step="devices"
        title="Use bb from anywhere"
        description="All optional. Everything here also lives in Settings → Machines."
        primaryLabel="Start using bb"
        onPrimary={() => setFinished(true)}
        onBack={noop}
        onSelectStep={noop}
        onSkipAll={noop}
        footerNote={
          finished
            ? checked
              ? "Preview: the job would be created."
              : "Preview: no job would be created."
            : undefined
        }
      >
        <DevicesStep
          connect={{ status: "off" }}
          connectSetup={null}
          connectSetupOpen={false}
          otherMachineCount={0}
          mobileLinks={{
            ios: "https://example.com",
            android: "https://example.com",
          }}
          onToggleConnectSetup={noop}
          onCopyConnectUrl={noop}
          onAddMachine={noop}
        />
        <SetupJobCheckbox
          offer={offer}
          checked={checked}
          disabled={false}
          onCheckedChange={setChecked}
        />
      </OnboardingLayout>
    </div>
  );
}

export const UnfinishedWork = () => <SetupJobStory arm="a" />;
export const FailingTests = () => <SetupJobStory arm="b" />;
