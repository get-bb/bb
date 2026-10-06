import GitBranchIcon from "@hugeicons/core-free-icons/GitBranchIcon";
import LockIcon from "@hugeicons/core-free-icons/LockIcon";
import { HugeiconsIcon } from "@hugeicons/react";
import type { CSSProperties } from "react";

import { AnywhereVisual } from "../compare/compare-visuals";

const SERVERS = [
  { branch: "feat/checkout", port: 3001 },
  { branch: "fix/login", port: 3002 },
  { branch: "main", port: 3003 },
];

const MACHINE = "bb-worker-1";

function delay(index: number): CSSProperties {
  return { animationDelay: `${index * 1.1}s` };
}

export function RemoteServersConcept() {
  return (
    <div
      className="gd-diagram"
      role="img"
      aria-label="Three branches on one remote machine, each dev server shared at its own getbb.app link"
    >
      <div className="gd-card">
        <div className="gd-card-head">
          <span className="gd-card-title">
            <span className="gd-live" />
            {MACHINE}
          </span>
          <span className="gd-card-detail">Linux · always on</span>
        </div>
        {SERVERS.map((server) => (
          <div key={server.port} className="gd-row">
            <span className="gd-branch">
              <HugeiconsIcon icon={GitBranchIcon} className="gd-ic" />
              {server.branch}
            </span>
            <span className="gd-cmd">PORT={server.port} pnpm dev</span>
            <span className="gd-port">:{server.port}</span>
          </div>
        ))}
      </div>
      <div className="gd-wires" aria-hidden="true">
        {SERVERS.map((server, index) => (
          <span
            key={server.port}
            className="gd-wire"
            style={{ top: `${76 + index * 48}px`, ...delay(index) }}
          />
        ))}
      </div>
      <div className="gd-card">
        <div className="gd-card-head">
          <span className="gd-card-title">
            <span className="bb-mark" />
            Shared links
          </span>
          <span className="gd-lock">
            <HugeiconsIcon icon={LockIcon} className="gd-ic" />
            Your account only
          </span>
        </div>
        {SERVERS.map((server, index) => (
          <div
            key={server.port}
            className="gd-row gd-link"
            style={delay(index)}
          >
            <span className="gd-url">
              {MACHINE}--<b>{server.port}</b>.getbb.app
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AnywhereConcept() {
  return (
    <div className="gd-anywhere">
      <AnywhereVisual />
    </div>
  );
}
