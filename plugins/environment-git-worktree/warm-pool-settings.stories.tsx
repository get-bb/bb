import { useState } from "react";
import {
  WarmPoolSettingsContent,
  type WarmPoolSizeChange,
} from "./warm-pool-settings.js";
import type { WarmPoolStatus } from "./warm-pools.js";

export default { title: "plugins/Warm worktrees" };

type Checkout = WarmPoolStatus["pools"][number]["checkouts"][number];

function checkout(
  overrides: Partial<Checkout> & Pick<Checkout, "hostId" | "hostName">,
): Checkout {
  return {
    path: "~/Projects/bb",
    size: 2,
    hostSize: null,
    ready: 2,
    preparing: 0,
    base: "main",
    lastError: null,
    ...overrides,
  };
}

const status: WarmPoolStatus = {
  pools: [
    {
      projectId: "prj_bb",
      projectName: "bb",
      size: 2,
      handedOff: 14,
      missed: 2,
      checkouts: [
        checkout({ hostId: "hst_laptop", hostName: "MacBook Pro" }),
        checkout({
          hostId: "hst_mini",
          hostName: "Mac mini",
          path: "/Users/build/code/bb",
          size: 4,
          hostSize: 4,
          ready: 1,
          preparing: 3,
        }),
        checkout({
          hostId: "hst_linux",
          hostName: "devbox",
          path: "/home/dev/src/bb",
          size: 0,
          hostSize: 0,
          ready: 0,
          base: null,
        }),
      ],
    },
    {
      projectId: "prj_site",
      projectName: "marketing-site",
      size: 0,
      handedOff: 0,
      missed: 0,
      checkouts: [
        checkout({
          hostId: "hst_laptop",
          hostName: "MacBook Pro",
          path: "~/Projects/site",
          size: 0,
          ready: 0,
          base: null,
        }),
        checkout({
          hostId: "hst_mini",
          hostName: "Mac mini",
          path: "/Users/build/code/site",
          size: 1,
          hostSize: 1,
          ready: 0,
          preparing: 0,
          lastError:
            "Setup failed in a warm worktree, trying again in 10 minutes: pnpm install exited with code 1",
        }),
      ],
    },
    {
      projectId: "prj_docs",
      projectName: "docs",
      size: 1,
      handedOff: 3,
      missed: 0,
      checkouts: [
        checkout({
          hostId: "hst_laptop",
          hostName: "MacBook Pro",
          path: "~/Projects/docs",
          size: 1,
          ready: 1,
        }),
      ],
    },
    {
      projectId: "prj_scratch",
      projectName: "scratch",
      size: 0,
      handedOff: 0,
      missed: 0,
      checkouts: [
        checkout({
          hostId: "hst_laptop",
          hostName: "MacBook Pro",
          path: "~/Projects/scratch",
          size: 0,
          ready: 0,
          base: null,
        }),
      ],
    },
  ],
};

function apply(current: WarmPoolStatus, change: WarmPoolSizeChange) {
  return {
    pools: current.pools.map((pool) => {
      if (pool.projectId !== change.projectId) return pool;
      const size = change.hostId === null ? change.size : pool.size;
      return {
        ...pool,
        size,
        checkouts: pool.checkouts.map((entry) => {
          const hostSize =
            change.hostId === entry.hostId ? change.size : entry.hostSize;
          return { ...entry, hostSize, size: hostSize ?? size };
        }),
      };
    }),
  };
}

export function Interactive() {
  const [current, setCurrent] = useState(status);
  return (
    <div className="max-w-2xl p-6">
      <WarmPoolSettingsContent
        status={current}
        error={null}
        saving={new Set()}
        onChange={(change) => setCurrent((value) => apply(value, change))}
      />
    </div>
  );
}
