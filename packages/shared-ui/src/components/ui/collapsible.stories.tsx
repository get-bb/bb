import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./collapsible.js";
import { Input } from "./input.js";
import { Icon } from "./icon.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/Collapsible",
};

function AdvancedSettingsDemo() {
  return (
    <Collapsible className="w-80 rounded-lg border border-border px-4">
      <CollapsibleTrigger className="flex w-full items-center gap-2 py-2.5 text-sm font-medium text-foreground">
        <Icon
          name="ChevronRight"
          className="size-4 transition-transform [[data-state=open]>&]:rotate-90"
        />
        Advanced
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-3 divide-y divide-border border-t border-border py-3">
          <div className="space-y-1 pt-3 first:pt-0">
            <label className="text-xs font-medium text-muted-foreground">
              Anthropic upstream base URL
            </label>
            <Input
              aria-label="Anthropic upstream base URL"
              placeholder="https://api.anthropic.com"
            />
          </div>
          <div className="space-y-1 pt-3">
            <label className="text-xs font-medium text-muted-foreground">
              OpenAI upstream base URL
            </label>
            <Input
              aria-label="OpenAI upstream base URL"
              placeholder="https://api.openai.com"
            />
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="Advanced settings disclosure"
        hint="plugins/account-pool/app.tsx — chevron-rotating disclosure revealing a divided settings-field list"
      >
        <AdvancedSettingsDemo />
      </StoryRow>
    </StoryCard>
  );
}
