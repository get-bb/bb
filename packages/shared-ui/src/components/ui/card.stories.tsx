import { Button } from "./button.js";
import { Card, CardContent } from "./card.js";
import { Icon } from "./icon.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/Card",
};

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="Connection status card"
        hint="vburojevic/bb-plugin-linear:app.tsx — ConnectionCard, no CardHeader since the host draws the section title"
      >
        <Card className="w-80">
          <CardContent className="flex items-center gap-3 py-3 text-sm text-muted-foreground">
            <div className="min-w-0 flex-1 space-y-1">
              <p className="truncate">Connected as jane in Acme Inc (acme)</p>
            </div>
            <Button variant="outline" size="sm" className="h-7 shrink-0 gap-1.5 text-xs">
              Open the panel
              <Icon name="ArrowRight" className="size-3" aria-hidden />
            </Button>
          </CardContent>
        </Card>
      </StoryRow>
    </StoryCard>
  );
}
