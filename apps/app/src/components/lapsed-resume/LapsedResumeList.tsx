import { useId } from "react";
import { useLocation } from "react-router-dom";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
  RouteAnchor,
  RouteNavigationCallbackContext,
} from "@/components/ui/app-route-anchor";
import { ThreadStatusGlyph } from "@/components/thread/ThreadStatusGlyph";
import { getThreadRoutePath } from "@/lib/route-paths";
import { useLapsedResume } from "./LapsedResumeProvider";

export function LapsedResumeList({ onNavigate }: { onNavigate: () => void }) {
  const resume = useLapsedResume();
  const headingId = useId();
  const location = useLocation();
  if (resume === null || resume.threads.length === 0) return null;

  return (
    <section aria-labelledby={headingId} className="shrink-0 px-2 pt-2">
      <div className="flex items-center justify-between gap-2 pl-2">
        <h2
          id={headingId}
          className="text-xs font-medium text-muted-foreground"
        >
          While you were away
        </h2>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label="Dismiss while you were away"
          onClick={resume.dismiss}
        >
          <Icon name="X" className="size-3.5" />
        </Button>
      </div>
      <RouteNavigationCallbackContext.Provider value={onNavigate}>
        <SidebarMenu>
          {resume.threads.map((thread) => {
            const path = getThreadRoutePath(thread);
            return (
              <SidebarMenuItem key={thread.threadId}>
                <SidebarMenuButton asChild>
                  <RouteAnchor
                    href={path}
                    aria-current={
                      location.pathname === path ? "page" : undefined
                    }
                  >
                    <ThreadStatusGlyph
                      indicator={
                        thread.status === "error"
                          ? "unread-error"
                          : thread.reason === "waiting"
                            ? "waiting-for-input"
                            : "unread-success"
                      }
                    />
                    <span>{thread.title}</span>
                  </RouteAnchor>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </RouteNavigationCallbackContext.Provider>
    </section>
  );
}
