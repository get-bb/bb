import { useState } from "react";
import {
  checkoutKey,
  WarmPoolSettingsContent,
  type WarmPoolFoldersChange,
  type WarmPoolSizeChange,
} from "./warm-pool-settings.js";
import type { WarmPoolStatus } from "./warm-pools.js";

export default { title: "plugins/Warm worktrees" };

type Pool = WarmPoolStatus["pools"][number];
type Checkout = Pool["checkouts"][number];

function checkout(
  overrides: Partial<Checkout> & Pick<Checkout, "hostId" | "hostName">,
): Checkout {
  return {
    path: "~/Projects/bb",
    size: 2,
    hostSize: null,
    folders: [],
    ready: 2,
    preparing: 0,
    base: "main",
    lastError: null,
    ...overrides,
  };
}

function pool(
  overrides: Partial<Pool> & Pick<Pool, "projectId" | "projectName">,
): Pool {
  return { size: 2, handedOff: 0, missed: 0, checkouts: [], ...overrides };
}

const LAPTOP = { hostId: "hst_laptop", hostName: "MacBook Pro" };
const MINI = { hostId: "hst_mini", hostName: "Mac mini" };
const DEVBOX = { hostId: "hst_linux", hostName: "devbox" };

const multipleMachines = pool({
  projectId: "prj_bb",
  projectName: "bb",
  handedOff: 14,
  missed: 2,
  checkouts: [
    checkout({ ...LAPTOP, folders: ["~/Projects/bb-api"] }),
    checkout({
      ...MINI,
      path: "/Users/build/code/bb",
      size: 4,
      hostSize: 4,
      ready: 1,
      preparing: 3,
      folders: ["/Users/build/code/bb-docs"],
    }),
    checkout({
      ...DEVBOX,
      path: "/home/dev/src/bb",
      size: 0,
      hostSize: 0,
      ready: 0,
      base: null,
    }),
  ],
});

const singleMachine = pool({
  projectId: "prj_app",
  projectName: "app",
  checkouts: [
    checkout({
      ...LAPTOP,
      path: "~/Projects/app",
      folders: ["~/Projects/app-api"],
    }),
  ],
});

const branchableFolders = new Map([
  [
    checkoutKey("prj_bb", LAPTOP.hostId),
    ["~/Projects/bb-api", "~/Projects/bb-docs"],
  ],
  [
    checkoutKey("prj_bb", MINI.hostId),
    ["/Users/build/code/bb-api", "/Users/build/code/bb-docs"],
  ],
  [
    checkoutKey("prj_bb", DEVBOX.hostId),
    ["/home/dev/src/bb-api", "/home/dev/src/bb-docs"],
  ],
  [
    checkoutKey("prj_app", LAPTOP.hostId),
    ["~/Projects/app-api", "~/Projects/app-web"],
  ],
  [checkoutKey("prj_gone", LAPTOP.hostId), ["~/Projects/site-assets"]],
]);

function applySize(current: WarmPoolStatus, change: WarmPoolSizeChange) {
  return {
    pools: current.pools.map((entry) => {
      if (entry.projectId !== change.projectId) return entry;
      const size = change.hostId === null ? change.size : entry.size;
      return {
        ...entry,
        size,
        checkouts: entry.checkouts.map((current) => {
          const hostSize =
            change.hostId === current.hostId ? change.size : current.hostSize;
          return { ...current, hostSize, size: hostSize ?? size };
        }),
      };
    }),
  };
}

function applyFolders(
  current: WarmPoolStatus,
  change: WarmPoolFoldersChange,
): WarmPoolStatus {
  return {
    pools: current.pools.map((entry) =>
      entry.projectId !== change.projectId
        ? entry
        : {
            ...entry,
            checkouts: entry.checkouts.map((current) =>
              current.hostId === change.hostId
                ? { ...current, folders: change.folders }
                : current,
            ),
          },
    ),
  };
}

function Settings(props: {
  status: WarmPoolStatus | null;
  error?: string;
  branchable?: ReadonlyMap<string, readonly string[]>;
}) {
  const [current, setCurrent] = useState(props.status);
  return (
    <div className="max-w-2xl p-6">
      <WarmPoolSettingsContent
        status={current}
        error={props.error ?? null}
        saving={new Set()}
        branchableFolders={props.branchable ?? branchableFolders}
        onChange={(change) =>
          setCurrent((value) =>
            value === null ? value : applySize(value, change),
          )
        }
        onFoldersChange={(change) =>
          setCurrent((value) =>
            value === null ? value : applyFolders(value, change),
          )
        }
      />
    </div>
  );
}

export function MultipleMachines() {
  return <Settings status={{ pools: [multipleMachines] }} />;
}

export function SingleMachine() {
  return <Settings status={{ pools: [singleMachine] }} />;
}

export function SingleMachineNoFoldersChosen() {
  return (
    <Settings
      status={{
        pools: [
          {
            ...singleMachine,
            checkouts: singleMachine.checkouts.map((entry) => ({
              ...entry,
              folders: [],
            })),
          },
        ],
      }}
    />
  );
}

export function PoolOff() {
  return (
    <Settings
      status={{
        pools: [
          {
            ...singleMachine,
            size: 0,
            checkouts: singleMachine.checkouts.map((entry) => ({
              ...entry,
              size: 0,
              ready: 0,
              base: null,
            })),
          },
        ],
      }}
    />
  );
}

export function NoGitProjectFolders() {
  return (
    <Settings
      status={{
        pools: [
          pool({
            projectId: "prj_plain",
            projectName: "plain",
            checkouts: [checkout({ ...LAPTOP, path: "~/Projects/plain" })],
          }),
        ],
      }}
    />
  );
}

export function FolderNoLongerInProject() {
  return (
    <Settings
      status={{
        pools: [
          pool({
            projectId: "prj_gone",
            projectName: "site",
            checkouts: [
              checkout({
                ...LAPTOP,
                path: "~/Projects/site",
                folders: ["~/Projects/site-cms"],
              }),
            ],
          }),
        ],
      }}
    />
  );
}

export function FoldersStillLoading() {
  return (
    <Settings status={{ pools: [singleMachine] }} branchable={new Map()} />
  );
}

export function SetupFailedOnOneMachine() {
  return (
    <Settings
      status={{
        pools: [
          pool({
            projectId: "prj_site",
            projectName: "marketing-site",
            size: 0,
            checkouts: [
              checkout({
                ...LAPTOP,
                path: "~/Projects/marketing-site",
                size: 0,
                ready: 0,
                base: null,
              }),
              checkout({
                ...MINI,
                path: "/Users/build/code/marketing-site",
                size: 1,
                hostSize: 1,
                ready: 0,
                lastError:
                  "Setup failed in a warm worktree, trying again in 10 minutes: pnpm install exited with code 1",
              }),
            ],
          }),
        ],
      }}
    />
  );
}

export function Loading() {
  return <Settings status={null} />;
}

export function LoadFailed() {
  return <Settings status={null} error="The Worktree plugin is not running" />;
}

export function Interactive() {
  return (
    <Settings
      status={{
        pools: [
          multipleMachines,
          singleMachine,
          pool({
            projectId: "prj_scratch",
            projectName: "scratch",
            size: 0,
            checkouts: [
              checkout({
                ...LAPTOP,
                path: "~/Projects/scratch",
                size: 0,
                ready: 0,
                base: null,
              }),
            ],
          }),
        ],
      }}
    />
  );
}
