import { Avatar, AvatarFallback, AvatarImage } from "@bb/shared-ui/avatar";
import { cn } from "@bb/shared-ui/lib/utils";
import type { PluginCatalogAuthor } from "@bb/server-contract";

export function pluginAuthorGithub(
  author: PluginCatalogAuthor | null,
): string | null {
  if (author?.url === null || author?.url === undefined) return null;
  try {
    const url = new URL(author.url);
    if (url.hostname !== "github.com" && url.hostname !== "www.github.com") {
      return null;
    }
    const [github] = url.pathname.split("/").filter(Boolean);
    return github ?? null;
  } catch {
    return null;
  }
}

function authorInitials(name: string): string {
  const initials = name
    .trim()
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase() ?? "")
    .join("");
  return initials === "" ? "?" : initials;
}

export function PluginAuthorAvatar({
  name,
  github,
  size,
}: {
  name: string;
  github: string | null;
  size: "detail" | "page";
}) {
  return (
    <Avatar
      role="img"
      aria-label={
        github === null ? `${name}'s avatar` : `${name}'s GitHub avatar`
      }
      className={cn(
        "border border-border bg-muted",
        size === "detail" ? "size-5" : "size-10",
      )}
    >
      {github === null ? null : (
        <AvatarImage
          src={`https://github.com/${github}.png?size=${size === "detail" ? 40 : 80}`}
          alt=""
          loading="lazy"
        />
      )}
      <AvatarFallback
        aria-hidden
        className={cn(
          "font-semibold text-subtle-foreground",
          size === "detail" ? "text-2xs" : "text-xs",
        )}
      >
        {authorInitials(name)}
      </AvatarFallback>
    </Avatar>
  );
}
