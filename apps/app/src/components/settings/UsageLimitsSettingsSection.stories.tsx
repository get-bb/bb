import { useState, type ReactNode } from "react";
import type { Host } from "@bb/domain";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import {
  UsageLimitsSettingsSectionContent,
  type UsageLimitsSettingsSectionContentProps,
} from "./UsageLimitsSettingsSection";

export default {
  title: "settings/Settings Page",
};

type Usage = UsageLimitsSettingsSectionContentProps["usage"];

const noop = () => {};

function futureIso(minutesFromNow: number): string {
  return new Date(Date.now() + minutesFromNow * 60_000).toISOString();
}

const HEALTHY_USAGE: Usage = {
  codex: {
    status: "ok",
    accountEmail: "sawyer@example.com",
    planLabel: "Pro",
    windows: [
      {
        label: "Weekly usage limit",
        usedPercent: 8,
        resetsAt: futureIso(5 * 24 * 60),
      },
    ],
  },
  claudeCode: {
    status: "ok",
    accountEmail: "sawyer@example.com",
    planLabel: "Max (20x)",
    windows: [
      {
        label: "Current session",
        usedPercent: 53,
        resetsAt: futureIso(187),
      },
      {
        label: "All models",
        usedPercent: 25,
        resetsAt: futureIso(67),
      },
      {
        label: "Fable",
        usedPercent: 48,
        resetsAt: futureIso(67),
      },
    ],
  },
  cursor: {
    status: "ok",
    accountEmail: "sawyer@example.com",
    planLabel: "Pro",
    windows: [
      {
        label: "Plan usage",
        usedPercent: 72,
        resetsAt: futureIso(14 * 24 * 60),
      },
      {
        label: "On-demand spend",
        usedPercent: 25,
        resetsAt: futureIso(14 * 24 * 60),
        cost: { usedUsdCents: 1_250, limitUsdCents: 5_000 },
      },
    ],
  },
};

const AUTH_USAGE: Usage = {
  codex: { status: "unauthenticated" },
  claudeCode: { status: "expired" },
  cursor: { status: "not_installed" },
};

const EMPTY_AND_ERROR_USAGE: Usage = {
  codex: {
    status: "ok",
    accountEmail: null,
    planLabel: "Team",
    windows: [],
  },
  claudeCode: {
    status: "error",
    message: "Claude usage is temporarily unavailable.",
  },
  cursor: { status: "not_installed" },
};

const THRESHOLD_USAGE: Usage = {
  codex: {
    status: "ok",
    accountEmail: "sawyer@example.com",
    planLabel: "Pro",
    windows: [
      { label: "Below warning", usedPercent: 79, resetsAt: null },
      { label: "Warning", usedPercent: 85, resetsAt: null },
      { label: "Critical", usedPercent: 98, resetsAt: null },
    ],
  },
  claudeCode: { status: "not_installed" },
  cursor: { status: "not_installed" },
};

const HOSTS: Host[] = [
  {
    id: "host-macbook",
    name: "MacBook Pro",
    type: "persistent",
    status: "connected",
    lastSeenAt: 1_700_000_000_000,
    maxPermissionMode: "full",
    lastRejectedProtocolVersion: null,
    createdAt: 1,
    updatedAt: 2,
  },
  {
    id: "host-studio",
    name: "Mac Studio",
    type: "persistent",
    status: "connected",
    lastSeenAt: 1_700_000_000_000,
    maxPermissionMode: "full",
    lastRejectedProtocolVersion: null,
    createdAt: 1,
    updatedAt: 2,
  },
  {
    id: "host-build",
    name: "Build machine",
    type: "persistent",
    status: "disconnected",
    lastSeenAt: 1_700_000_000_000,
    maxPermissionMode: "full",
    lastRejectedProtocolVersion: null,
    createdAt: 1,
    updatedAt: 2,
  },
];

function Stage({ children }: { children: ReactNode }) {
  return <div className="w-full min-w-0 max-w-3xl">{children}</div>;
}

type UsagePreviewProps = Pick<UsageLimitsSettingsSectionContentProps, "usage"> &
  Partial<
    Pick<
      UsageLimitsSettingsSectionContentProps,
      | "hosts"
      | "isError"
      | "isFetching"
      | "isLoading"
      | "onSelectHost"
      | "selectedHostId"
    >
  >;

function UsagePreview({
  usage,
  hosts,
  isError = false,
  isFetching = false,
  isLoading = false,
  onSelectHost,
  selectedHostId,
}: UsagePreviewProps) {
  return (
    <Stage>
      <UsageLimitsSettingsSectionContent
        usage={usage}
        isLoading={isLoading}
        isError={isError}
        isFetching={isFetching}
        onRefresh={noop}
        hosts={hosts}
        selectedHostId={selectedHostId}
        onSelectHost={onSelectHost}
      />
    </Stage>
  );
}

function MultipleMachinesPreview() {
  const [selectedHostId, setSelectedHostId] = useState(HOSTS[0]?.id ?? null);

  return (
    <UsagePreview
      usage={HEALTHY_USAGE}
      hosts={HOSTS}
      selectedHostId={selectedHostId}
      onSelectHost={setSelectedHostId}
    />
  );
}

export function Usage() {
  return (
    <StoryCard labelWidth="170px">
      <StoryRow
        label="complete usage"
        hint="Provider plans, Claude Fable, and Cursor on-demand spend"
      >
        <UsagePreview usage={HEALTHY_USAGE} />
      </StoryRow>
      <StoryRow
        label="usage thresholds"
        hint="Default, warning, and critical progress treatments"
      >
        <UsagePreview usage={THRESHOLD_USAGE} />
      </StoryRow>
      <StoryRow
        label="authentication"
        hint="Signed out, expired, and uninstalled providers"
      >
        <UsagePreview usage={AUTH_USAGE} />
      </StoryRow>
      <StoryRow
        label="provider responses"
        hint="An empty plan beside a provider-specific error"
      >
        <UsagePreview usage={EMPTY_AND_ERROR_USAGE} />
      </StoryRow>
      <StoryRow label="loading" hint="Initial request with no cached data">
        <UsagePreview usage={{}} isLoading />
      </StoryRow>
      <StoryRow
        label="refreshing"
        hint="Existing data remains visible while reload is in progress"
      >
        <UsagePreview usage={HEALTHY_USAGE} isFetching />
      </StoryRow>
      <StoryRow label="unavailable" hint="No data returned for any provider">
        <UsagePreview usage={{}} />
      </StoryRow>
      <StoryRow
        label="request failed"
        hint="The selected machine could not return usage"
      >
        <UsagePreview usage={{}} isError />
      </StoryRow>
      <StoryRow
        label="multiple machines"
        hint="Connected machines are selectable; disconnected ones are disabled"
      >
        <MultipleMachinesPreview />
      </StoryRow>
    </StoryCard>
  );
}
