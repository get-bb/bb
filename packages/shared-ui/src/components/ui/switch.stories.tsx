import { useState } from "react";
import { Switch } from "./switch.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/Switch",
};

function KeepAwakeMasterToggleDemo() {
  const [enabled, setEnabled] = useState(true);
  return (
    <Switch
      checked={enabled}
      size="default"
      aria-label="Keep Awake"
      onCheckedChange={setEnabled}
    />
  );
}

function ProviderRoutingRowDemo() {
  const [routing, setRouting] = useState(true);
  const [pending, setPending] = useState(false);

  return (
    <div className="flex w-64 items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
      <span>Route Anthropic threads</span>
      <Switch
        checked={routing}
        size="sm"
        disabled={pending}
        aria-label="Route Anthropic threads"
        onCheckedChange={(next) => {
          setPending(true);
          setTimeout(() => {
            setRouting(next);
            setPending(false);
          }, 300);
        }}
      />
    </div>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="Settings master toggle"
        hint="plugins/keep-awake/app.tsx — default-size switch as the view's top-level enable/disable control"
      >
        <KeepAwakeMasterToggleDemo />
      </StoryRow>
      <StoryRow
        label="Per-row routing toggle"
        hint="plugins/account-pool/app.tsx — sm switch in a settings row, disabled while its own RPC call is pending"
      >
        <ProviderRoutingRowDemo />
      </StoryRow>
    </StoryCard>
  );
}
