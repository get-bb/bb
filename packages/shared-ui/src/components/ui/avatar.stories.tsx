import { Avatar, AvatarFallback, AvatarImage } from "./avatar.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/Avatar",
};

function authorInitials(name: string): string {
  const initials = name
    .trim()
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase() ?? "")
    .join("");
  return initials === "" ? "?" : initials;
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="Detail size, real GitHub avatar"
        hint="apps/app/src/components/plugin/management/PluginAuthorAvatar.tsx — size-5, image + initials fallback"
      >
        <Avatar
          role="img"
          aria-label="octocat's GitHub avatar"
          className="size-5 border border-border bg-muted"
        >
          <AvatarImage
            src="https://github.com/octocat.png?size=40"
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
          />
          <AvatarFallback aria-hidden className="text-2xs font-semibold text-subtle-foreground">
            {authorInitials("The Octocat")}
          </AvatarFallback>
        </Avatar>
      </StoryRow>
      <StoryRow
        label="Page size, image failed to load"
        hint="same component, size-10 — AvatarFallback renders when AvatarImage has no src or fails"
      >
        <Avatar role="img" aria-label="Jane Doe's avatar" className="size-10 border border-border bg-muted">
          <AvatarFallback aria-hidden className="text-xs font-semibold text-subtle-foreground">
            {authorInitials("Jane Doe")}
          </AvatarFallback>
        </Avatar>
      </StoryRow>
      <StoryRow
        label="Official bb-authored plugin"
        hint="official=true renders a wordmark instead of initials — BbLogo (app-only SVG) is stubbed here as plain text"
      >
        <Avatar role="img" aria-label="bb's avatar" className="size-10 border border-border bg-muted">
          <AvatarImage
            src="https://github.com/get-bb.png?size=80"
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
          />
          <AvatarFallback aria-hidden className="text-xs font-semibold text-subtle-foreground">
            BB
          </AvatarFallback>
        </Avatar>
      </StoryRow>
    </StoryCard>
  );
}
