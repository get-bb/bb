import { useState } from "react";
import { ExpandableText } from "@bb/shared-ui/expandable-text";
import { OnboardingPluginCard } from "../onboarding/OnboardingViews";
import { ModelLoadErrorMessage } from "../pickers/model-load-error-message";

export default { title: "Readability/Expandable text" };

const description =
  "Let BB control the in-app browser and browsers on connected machines, with inline previews for headless sessions. Navigate pages, inspect elements, fill forms, and verify changes with screenshots. Sessions remain available between agent turns so you can follow progress and resume work without losing your place. Use the browser preview to check the result before continuing with the next step.";
const error =
  "The package registry could not be reached. Check your network connection and proxy settings, then try again. The request timed out while downloading the provider package from the registry. If your network requires a proxy, configure it for the host running this agent. Your existing projects and conversations have not been changed.";

export function Descriptions() {
  const [enabled, setEnabled] = useState(false);
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6 p-4">
      <h1 className="text-lg font-semibold">Description disclosures</h1>
      <p className="text-sm text-muted-foreground">
        Expand the description: the plugin should stay off. Use its switch to
        enable it.
      </p>
      <OnboardingPluginCard
        name="Browser Automation"
        description={description}
        icon={{ icon: "Globe", iconUrl: null, iconTinted: false }}
        enabled={enabled}
        pending={false}
        unavailableReason={null}
        onToggle={setEnabled}
      />
      <p role="status" className="text-sm">
        Plugin is {enabled ? "on" : "off"}.
      </p>
      <section className="space-y-2 rounded-lg border border-border p-4">
        <h2 className="text-sm font-medium">Settings description</h2>
        <ExpandableText className="text-xs text-muted-foreground">
          {description}
        </ExpandableText>
      </section>
      <section className="space-y-2 rounded-lg border border-border p-4">
        <h2 className="text-sm font-medium">Short description</h2>
        <ExpandableText className="text-xs text-muted-foreground">
          Run durable agent workflows.
        </ExpandableText>
      </section>
    </div>
  );
}

export function Errors() {
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6 p-4">
      <h1 className="text-lg font-semibold">Error disclosures</h1>
      <section className="space-y-2 rounded-lg border border-border p-4">
        <h2 className="text-sm font-medium">Agent setup error</h2>
        <ExpandableText
          expandLabel="Show details"
          className="text-xs text-destructive-text"
        >
          {error}
        </ExpandableText>
      </section>
      <section className="rounded-lg border border-border p-4 text-xs text-muted-foreground">
        <ModelLoadErrorMessage
          providerLabel="Example provider"
          error={{ providerId: "example", code: "failed", detail: error }}
        />
      </section>
      <section className="space-y-2 rounded-lg border border-border p-4">
        <h2 className="text-sm font-medium">Short error</h2>
        <ExpandableText
          expandLabel="Show details"
          className="text-xs text-destructive-text"
        >
          Not signed in.
        </ExpandableText>
      </section>
    </div>
  );
}
