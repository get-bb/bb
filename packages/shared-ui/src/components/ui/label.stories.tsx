import { useId, useState } from "react";
import { Label } from "./label.js";
import { Input } from "./input.js";
import { Button } from "./button.js";
import { Icon } from "./icon.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/Label",
};

function SecretFieldDemo() {
  const inputId = useId();
  const [value, setValue] = useState("sk-live-••••••••••••");
  const [revealed, setRevealed] = useState(false);

  return (
    <div className="w-72 space-y-1.5">
      <div className="space-y-0.5">
        <Label
          htmlFor={inputId}
          className="font-mono text-xs font-semibold text-foreground"
        >
          ANTHROPIC_API_KEY
        </Label>
        <p className="text-xs leading-snug text-muted-foreground">
          Used for provider requests from this plugin.
        </p>
      </div>
      <div className="relative">
        <Input
          id={inputId}
          type={revealed ? "text" : "password"}
          autoComplete="off"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="pr-11 font-mono"
        />
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="absolute right-1 top-1/2 size-7 -translate-y-1/2 text-muted-foreground"
          aria-label={`${revealed ? "Hide" : "Show"} ANTHROPIC_API_KEY`}
          aria-pressed={revealed}
          onClick={() => setRevealed((current) => !current)}
        >
          <Icon name={revealed ? "EyeOff" : "Eye"} />
        </Button>
      </div>
    </div>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="Secret field label"
        hint="plugins/secrets/app.tsx — Label + password-style Input + icon-button reveal toggle"
      >
        <SecretFieldDemo />
      </StoryRow>
    </StoryCard>
  );
}
