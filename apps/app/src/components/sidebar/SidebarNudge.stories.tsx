import type { ReactNode } from "react";
import { Icon } from "@bb/shared-ui/icon";
import { SidebarNudge } from "@bb/shared-ui/sidebar-nudge";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";

export default {
  title: "sidebar/Sidebar Nudge",
};

const noop = () => {};

function SidebarFooterFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-[340px] w-[268px] flex-col justify-end rounded-lg border border-border-hairline bg-sidebar p-2">
      {children}
      <div className="flex items-center gap-4 px-2 py-2 text-muted-foreground">
        <Icon aria-hidden name="Smartphone" className="size-4" />
        <Icon aria-hidden name="Bug" className="size-4" />
        <Icon aria-hidden name="MoreHorizontal" className="size-4" />
      </div>
    </div>
  );
}

export function Overview() {
  return (
    <StoryCard labelWidth="200px">
      <StoryRow
        label="notifications"
        hint="Shown once a thread is running and browser permission is undecided. Body only, one action, dismiss reads as Not now."
      >
        <SidebarFooterFrame>
          <SidebarNudge
            icon={<Icon aria-hidden name="BellDot" className="size-4" />}
            action={{ label: "Notify me", onAction: noop }}
            onDismiss={noop}
            dismissLabel="Not now"
          >
            Get a notification when this agent finishes or asks you a question,
            even in another tab.
          </SidebarNudge>
        </SidebarFooterFrame>
      </StoryRow>
      <StoryRow
        label="mobile app"
        hint="The same nudge after the notification card is answered."
      >
        <SidebarFooterFrame>
          <SidebarNudge
            icon={<Icon aria-hidden name="Smartphone" className="size-4" />}
            action={{ label: "Get the mobile app", onAction: noop }}
            onDismiss={noop}
          >
            Check on agents from your phone and reply when one needs you.
          </SidebarNudge>
        </SidebarFooterFrame>
      </StoryRow>
      <StoryRow
        label="no action"
        hint="A nudge that only informs still keeps one dismiss control."
      >
        <SidebarFooterFrame>
          <SidebarNudge
            icon={<Icon aria-hidden name="CircleCheck" className="size-4" />}
            onDismiss={noop}
          >
            Notifications are on for this browser.
          </SidebarNudge>
        </SidebarFooterFrame>
      </StoryRow>
    </StoryCard>
  );
}
