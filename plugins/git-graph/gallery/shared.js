export const LANE_COLORS = [
  "#4f8ef7",
  "#e061c1",
  "#3fb950",
  "#d98500",
  "#a371f7",
  "#f0883e",
  "#2dd4bf",
  "#db61a2",
  "#9ece6a",
  "#7aa2f7",
];

export function laneColor(colorIndex) {
  const count = LANE_COLORS.length;
  return LANE_COLORS[((colorIndex % count) + count) % count];
}

export function computeLanes(commits) {
  const rows = [];
  const lanes = [];
  let colorCounter = 0;
  let maxLane = 0;

  const firstFreeLane = () => {
    for (let index = 0; index < lanes.length; index += 1) {
      if (lanes[index] === null) return index;
    }
    return -1;
  };
  const allocateLane = (target) => {
    const free = firstFreeLane();
    const colorIndex = colorCounter % LANE_COLORS.length;
    colorCounter += 1;
    if (free >= 0) {
      lanes[free] = { target, colorIndex };
      return free;
    }
    lanes.push({ target, colorIndex });
    return lanes.length - 1;
  };
  const lanesTargeting = (hash) => {
    const found = [];
    for (let index = 0; index < lanes.length; index += 1) {
      const slot = lanes[index];
      if (slot !== null && slot.target === hash) found.push(index);
    }
    return found;
  };

  for (const commit of commits) {
    const incoming = lanesTargeting(commit.hash);
    const hadIncomingAbove = incoming.length > 0;
    let dotLane;
    let dotColor;
    if (incoming.length === 0) {
      dotLane = allocateLane(commit.hash);
      dotColor = lanes[dotLane].colorIndex;
    } else {
      dotLane = incoming[0];
      dotColor = lanes[dotLane].colorIndex;
    }

    const passThrough = [];
    for (let index = 0; index < lanes.length; index += 1) {
      const slot = lanes[index];
      if (slot !== null && slot.target !== commit.hash) {
        passThrough.push({ lane: index, colorIndex: slot.colorIndex });
      }
    }
    const intoDot = hadIncomingAbove
      ? incoming.map((lane) => ({
          fromLane: lane,
          colorIndex: lanes[lane].colorIndex,
        }))
      : [];

    for (let index = 0; index < lanes.length; index += 1) {
      const slot = lanes[index];
      if (slot !== null && slot.target === commit.hash) lanes[index] = null;
    }

    const outOfDot = [];
    let isRoot = false;
    if (commit.parents.length === 0) {
      isRoot = true;
    } else {
      const [firstParent, ...restParents] = commit.parents;
      const firstParentTarget = lanesTargeting(firstParent);
      if (firstParentTarget.length > 0) {
        outOfDot.push({
          toLane: firstParentTarget[0],
          colorIndex: dotColor,
        });
      } else if (lanes[dotLane] === null) {
        lanes[dotLane] = { target: firstParent, colorIndex: dotColor };
        outOfDot.push({ toLane: dotLane, colorIndex: dotColor });
      } else {
        const free = firstFreeLane();
        if (free >= 0) {
          lanes[free] = { target: firstParent, colorIndex: dotColor };
          outOfDot.push({ toLane: free, colorIndex: dotColor });
        } else {
          lanes.push({ target: firstParent, colorIndex: dotColor });
          outOfDot.push({ toLane: lanes.length - 1, colorIndex: dotColor });
        }
      }
      for (const parent of restParents) {
        const existing = lanesTargeting(parent);
        if (existing.length > 0) {
          outOfDot.push({ toLane: existing[0], colorIndex: dotColor });
          continue;
        }
        const lane = allocateLane(parent);
        outOfDot.push({ toLane: lane, colorIndex: dotColor });
      }
    }

    maxLane = Math.max(
      maxLane,
      dotLane,
      ...passThrough.map((s) => s.lane),
      ...intoDot.map((s) => s.fromLane),
      ...outOfDot.map((s) => s.toLane),
    );

    rows.push({
      hash: commit.hash,
      lane: dotLane,
      colorIndex: dotColor,
      passThrough,
      intoDot,
      outOfDot,
      isRoot,
    });
  }
  return { rows, maxLane };
}

export function commitsByHash(commits) {
  return new Map(commits.map((commit) => [commit.hash, commit]));
}

export function ancestorsOf(commits, hash) {
  const byHash = commitsByHash(commits);
  const seen = new Set([hash]);
  const stack = [hash];
  while (stack.length > 0) {
    const current = stack.pop();
    const commit = byHash.get(current);
    if (commit === undefined) continue;
    for (const parent of commit.parents) {
      if (!seen.has(parent)) {
        seen.add(parent);
        stack.push(parent);
      }
    }
  }
  return seen;
}

export function childrenMapOf(commits) {
  const children = new Map(commits.map((commit) => [commit.hash, []]));
  for (const commit of commits) {
    for (const parent of commit.parents) {
      children.get(parent)?.push(commit.hash);
    }
  }
  return children;
}

export function descendantsOf(commits, hash) {
  const children = childrenMapOf(commits);
  const seen = new Set([hash]);
  const stack = [hash];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const child of children.get(current) ?? []) {
      if (!seen.has(child)) {
        seen.add(child);
        stack.push(child);
      }
    }
  }
  return seen;
}

export function depthFromRoots(commits) {
  const byHash = commitsByHash(commits);
  const depths = new Map();
  const visiting = new Set();
  const depthOf = (hash) => {
    const cached = depths.get(hash);
    if (cached !== undefined) return cached;
    if (visiting.has(hash)) return 0;
    visiting.add(hash);
    const commit = byHash.get(hash);
    let depth = 0;
    if (commit !== undefined && commit.parents.length > 0) {
      depth =
        1 +
        Math.max(
          ...commit.parents.map((parent) =>
            byHash.has(parent) ? depthOf(parent) : -1,
          ),
        );
    }
    visiting.delete(hash);
    depths.set(hash, depth);
    return depth;
  };
  for (const commit of commits) depthOf(commit.hash);
  return depths;
}

export function relativeTime(iso) {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, (Date.now() - then) / 1000);
  if (seconds < 3_600) return `${Math.max(1, Math.floor(seconds / 60))}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

export function refLabel(ref) {
  if (ref.isHead && ref.kind === "branch") return `HEAD → ${ref.name}`;
  if (ref.isHead) return "HEAD";
  return ref.name;
}
