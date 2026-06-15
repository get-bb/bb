import type { ReactNode } from "react";
import type { ThreadListEntry } from "@bb/domain";
import { StoryCard, StoryRow } from "../../.ladle/story-card";
import {
  PROJECT_IDS,
  PROJECT_NAMES,
  makeThreadListEntry,
} from "../../.ladle/story-fixtures";
import { RootComposeMobileRecents } from "./RootComposeMobileRecents";

export default {
  title: "views/Mobile Recents",
};

interface MobileStageProps {
  children: ReactNode;
}

interface MakeRecentThreadArgs {
  overrides?: Partial<ThreadListEntry>;
}

function MobileStage({ children }: MobileStageProps) {
  return (
    <div className="root-compose-mobile-recents-story w-[390px] max-w-full bg-background p-4">
      <style>{`
        @media (min-width: 768px) {
          .root-compose-mobile-recents-story [data-root-compose-mobile-recents] {
            display: block;
          }
        }
      `}</style>
      {children}
    </div>
  );
}

function makeRecentThread({
  overrides = {},
}: MakeRecentThreadArgs = {}): ThreadListEntry {
  return makeThreadListEntry({
    projectId: PROJECT_IDS.bb,
    ...overrides,
  });
}

const recentThreads: ThreadListEntry[] = [
  makeRecentThread({
    overrides: {
      id: "thr_mobile_just_starting",
      title: "Trace mobile thread creation feedback",
      titleFallback: "Trace mobile thread creation feedback",
      status: "starting",
      createdAt: 300,
      latestAttentionAt: 300,
      runtime: {
        displayStatus: "starting",
        hostReconnectGraceExpiresAt: null,
      },
    },
  }),
  makeRecentThread({
    overrides: {
      id: "thr_mobile_working",
      projectId: PROJECT_IDS.pierre,
      title: "Review prompt box spacing on iPhone",
      titleFallback: "Review prompt box spacing on iPhone",
      status: "active",
      createdAt: 250,
      latestAttentionAt: 250,
      runtime: {
        displayStatus: "active",
        hostReconnectGraceExpiresAt: null,
      },
    },
  }),
  makeRecentThread({
    overrides: {
      id: "thr_mobile_ready",
      title: "Backfill root compose tests",
      titleFallback: "Backfill root compose tests",
      createdAt: 200,
      latestAttentionAt: 200,
    },
  }),
];

const statusThreads: ThreadListEntry[] = [
  makeRecentThread({
    overrides: {
      id: "thr_mobile_pending",
      title: "Needs environment approval",
      titleFallback: "Needs environment approval",
      hasPendingInteraction: true,
      status: "active",
      createdAt: 500,
      latestAttentionAt: 500,
      runtime: {
        displayStatus: "active",
        hostReconnectGraceExpiresAt: null,
      },
    },
  }),
  makeRecentThread({
    overrides: {
      id: "thr_mobile_reconnecting",
      projectId: PROJECT_IDS.pierre,
      title: "Host reconnecting after sleep",
      titleFallback: "Host reconnecting after sleep",
      status: "active",
      createdAt: 450,
      latestAttentionAt: 450,
      runtime: {
        displayStatus: "host-reconnecting",
        hostReconnectGraceExpiresAt: 600,
      },
    },
  }),
  makeRecentThread({
    overrides: {
      id: "thr_mobile_error",
      title: "Runtime failed to start",
      titleFallback: "Runtime failed to start",
      status: "error",
      createdAt: 400,
      latestAttentionAt: 400,
      runtime: {
        displayStatus: "error",
        hostReconnectGraceExpiresAt: null,
      },
    },
  }),
];

const projectNamesById = new Map<string, string>([
  [PROJECT_IDS.bb, PROJECT_NAMES.bb],
  [PROJECT_IDS.pierre, PROJECT_NAMES.pierre],
]);

export function Overview() {
  return (
    <StoryCard labelWidth="170px">
      <StoryRow label="just starting">
        <MobileStage>
          <RootComposeMobileRecents
            highlightedThreadId="thr_mobile_just_starting"
            projectNamesById={projectNamesById}
            showCreatingRow={false}
            threads={recentThreads}
          />
        </MobileStage>
      </StoryRow>
      <StoryRow label="creating">
        <MobileStage>
          <RootComposeMobileRecents
            highlightedThreadId={null}
            projectNamesById={projectNamesById}
            showCreatingRow
            threads={recentThreads.slice(1)}
          />
        </MobileStage>
      </StoryRow>
      <StoryRow label="status variants">
        <MobileStage>
          <RootComposeMobileRecents
            highlightedThreadId={null}
            projectNamesById={projectNamesById}
            showCreatingRow={false}
            threads={statusThreads}
          />
        </MobileStage>
      </StoryRow>
    </StoryCard>
  );
}
