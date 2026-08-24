import type { ThreadPullRequest } from "@bb/domain";
import { View } from "react-native";
import {
  getPullRequestGithubCheckStatus,
  PULL_REQUEST_STATE_DISPLAY,
  type GithubCheckStatus,
  type PullRequestDisplayTone,
} from "@/data/environments";
import { useTheme, type NativeThemeTokens } from "@/theme";
import { Icon, type IconName } from "@/ui";

export function pullRequestToneColor(
  tokens: NativeThemeTokens,
  tone: PullRequestDisplayTone,
): string {
  switch (tone) {
    case "success":
      return tokens.success;
    case "destructive":
      return tokens.destructiveText;
    case "warning":
      return tokens.warningText;
    case "merged":
      return tokens.prMerged;
    case "muted":
      return tokens.mutedForeground;
  }
}

const CHECK_GLYPH: Record<
  GithubCheckStatus,
  { icon: IconName; tone: PullRequestDisplayTone }
> = {
  success: { icon: "CircleCheck", tone: "success" },
  failure: { icon: "CircleX", tone: "destructive" },
  pending: { icon: "Clock", tone: "warning" },
};

/**
 * PR state glyph (open / draft / merged / closed, toned) plus the checks
 * glyph for live PRs — the web PullRequestStatusPill without GitHub's
 * favicon images (the theme's own check / cross / clock icons instead).
 */
export function PullRequestStatusPill({
  pullRequest,
  size = 14,
}: {
  pullRequest: ThreadPullRequest;
  size?: number;
}) {
  const { tokens } = useTheme();
  const state = PULL_REQUEST_STATE_DISPLAY[pullRequest.state];
  const checkStatus = getPullRequestGithubCheckStatus(pullRequest);
  const check = checkStatus === null ? null : CHECK_GLYPH[checkStatus];
  return (
    <View
      className="flex-row items-center gap-1"
      accessibilityLabel={`${state.label} pull request`}
      testID="pull-request-status-pill"
    >
      <Icon
        name={state.icon}
        size={size}
        color={pullRequestToneColor(tokens, state.tone)}
      />
      {check ? (
        <Icon
          name={check.icon}
          size={size}
          color={pullRequestToneColor(tokens, check.tone)}
        />
      ) : null}
    </View>
  );
}
