import { z } from "zod";
import {
  matchProfileForWebLink,
  type LinkProfileLike,
} from "@/lib/links/incoming-link";

export interface PushNotificationTarget {
  threadId: string | null;
  projectId: string | null;
  serverUrl: string | null;
}

const pushDataSchema = z.object({
  threadId: z.string().min(1).nullish(),
  projectId: z.string().min(1).nullish(),
  serverUrl: z.string().min(1).nullish(),
  url: z.string().min(1).nullish(),
});

function normalizedHint(value: string, preservePath: boolean): string | null {
  try {
    const url = new URL(value);
    if (!preservePath || url.pathname === "/") return url.origin;
    return `${url.origin}${url.pathname.replace(/\/+$/u, "")}`;
  } catch {
    return null;
  }
}

export function parsePushNotificationData(
  data: unknown,
): PushNotificationTarget | null {
  const parsed = pushDataSchema.safeParse(data);
  if (!parsed.success) return null;
  const hintedServerUrl = parsed.data.serverUrl ?? null;
  const fallbackUrl = parsed.data.url ?? null;
  const serverUrl = hintedServerUrl
    ? normalizedHint(hintedServerUrl, true)
    : fallbackUrl
      ? normalizedHint(fallbackUrl, false)
      : null;
  const threadId = parsed.data.threadId ?? null;
  if (threadId === null && serverUrl === null) return null;
  return {
    threadId,
    projectId: parsed.data.projectId ?? null,
    serverUrl,
  };
}

export interface ResolvePushTargetProfileDeps {
  profiles: readonly LinkProfileLike[];
  activeProfileId: string | null;
  hasThread(serverUrl: string, threadId: string): Promise<boolean>;
}

export async function resolvePushTargetProfile(
  target: PushNotificationTarget,
  deps: ResolvePushTargetProfileDeps,
): Promise<LinkProfileLike | null> {
  const { profiles } = deps;
  if (profiles.length === 0) return null;
  if (target.serverUrl) {
    try {
      const hint = new URL(target.serverUrl);
      const match = matchProfileForWebLink(
        profiles,
        hint.origin,
        hint.pathname,
      );
      if (match) return match.profile;
    } catch {}
  }
  const { threadId } = target;
  if (threadId === null) return null;
  const ordered = [
    ...profiles.filter((profile) => profile.id === deps.activeProfileId),
    ...profiles.filter((profile) => profile.id !== deps.activeProfileId),
  ];
  for (const profile of ordered) {
    try {
      if (await deps.hasThread(profile.serverUrl, threadId)) {
        return profile;
      }
    } catch {}
  }
  return null;
}
