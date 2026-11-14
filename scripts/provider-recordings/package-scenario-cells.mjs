#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { hostname, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const USAGE =
  "usage: package-scenario-cells.mjs --raw <dir> --versions '<json provider→cli version>' [--cells <a,b>] [--providers <a,b>]";
const SCENARIO_CELLS = [
  "settings-follow-up",
  "settings-steer",
  "steer-race",
  "provider-exit",
];
const LANES = [
  "runtime→bridge",
  "bridge→runtime",
  "provider→bridge",
  "bridge→provider",
];

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith("--") || argv[i + 1] === undefined) {
      throw new Error(`bad argument ${argv[i]}\n${USAGE}`);
    }
    args[argv[i].slice(2)] = argv[i + 1];
  }
  if (!args.raw || !args.versions) throw new Error(USAGE);
  return {
    raw: resolve(args.raw),
    versions: JSON.parse(args.versions),
    cells: args.cells?.split(","),
    providers: args.providers?.split(","),
  };
}

function parse(line) {
  try {
    const value = JSON.parse(line);
    return typeof value === "object" && value !== null ? value : null;
  } catch {
    return null;
  }
}

function readLane(dir, lane) {
  const file = join(dir, `${lane}.ndjson`);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line));
}

function writeLane(dir, lane, entries) {
  writeFileSync(
    join(dir, `${lane}.ndjson`),
    entries.map((entry) => `${JSON.stringify(entry)}\n`).join(""),
  );
}

function updateManifest(dir, change) {
  const file = join(dir, "manifest.json");
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  change(manifest);
  for (const lane of LANES) manifest.lines[lane] = readLane(dir, lane).length;
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
}

function addNote(manifest, text) {
  manifest.note = manifest.note === "" ? text : `${manifest.note} ${text}`;
}

function trimCodexConfigRead(dir) {
  const requests = new Set(
    readLane(dir, "bridge→provider")
      .filter((entry) => parse(entry.line)?.method === "config/read")
      .map((entry) => `${entry.run}:${parse(entry.line).id}`),
  );
  let trimmed = 0;
  const lane = readLane(dir, "provider→bridge").map((entry) => {
    const message = parse(entry.line);
    if (
      message === null ||
      "method" in message ||
      !requests.has(`${entry.run}:${message.id}`) ||
      message.result?.config === undefined
    ) {
      return entry;
    }
    trimmed += 1;
    message.result = {
      config: { model: message.result.config.model },
      origins: {},
    };
    return { ...entry, line: JSON.stringify(message) };
  });
  if (trimmed === 0) return;
  writeLane(dir, "provider→bridge", lane);
  updateManifest(dir, (manifest) =>
    addNote(
      manifest,
      "config/read responses trimmed to config.model; the rest was the recording machine's Codex config.",
    ),
  );
}

function dropClaudeHookEchoes(dir) {
  const lane = readLane(dir, "provider→bridge");
  const minted = new Set(
    lane
      .map((entry) => parse(entry.line))
      .filter((message) => message?.type === "control_request")
      .map((message) => message.request_id),
  );
  const kept = lane.filter((entry) => {
    const message = parse(entry.line);
    return !(
      message?.type === "control_response" &&
      minted.has(message.response?.request_id)
    );
  });
  if (kept.length === lane.length) return;
  writeLane(dir, "provider→bridge", kept);
  updateManifest(dir, (manifest) =>
    addNote(
      manifest,
      `Dropped ${lane.length - kept.length} control_response lines the CLI echoed back for its own hook callbacks; the replay child would wait on them as answers to bridge requests.`,
    ),
  );
}

function piLineOwners(entries) {
  const children = [];
  const owners = new Map();
  const latest = () => children.length - 1;
  entries.forEach((entry, index) => {
    if (entry.dir !== "bridge→provider" && entry.dir !== "provider→bridge")
      return;
    const message = parse(entry.line);
    const channel = message?.bbChannel ?? null;
    if (
      entry.dir === "bridge→provider" &&
      channel === null &&
      message?.type === "get_state" &&
      message.id === "bb-1"
    ) {
      children.push({
        last: 1,
        pending: new Set(["bb-1"]),
        aborted: false,
        leafAsked: false,
        channel: new Set(),
      });
      owners.set(index, latest());
      return;
    }
    if (children.length === 0 || message === null) return;
    let owner = latest();
    if (
      entry.dir === "bridge→provider" &&
      channel === null &&
      /^bb-\d+$/.test(message.id ?? "")
    ) {
      const counter = Number(message.id.slice(3));
      const match = children.findLastIndex(
        (child) => child.last === counter - 1,
      );
      owner = match === -1 ? latest() : match;
      children[owner].last = counter;
      children[owner].pending.add(message.id);
      if (message.type === "abort") children[owner].aborted = true;
    } else if (
      entry.dir === "provider→bridge" &&
      channel === null &&
      message.type === "response"
    ) {
      const match = children.findLastIndex((child) =>
        child.pending.has(message.id),
      );
      if (match !== -1) {
        owner = match;
        children[owner].pending.delete(message.id);
      }
    } else if (entry.dir === "bridge→provider" && channel?.kind === "request") {
      const retiring =
        channel.method === "leaf"
          ? children
              .slice(0, -1)
              .findLastIndex((child) => child.aborted && !child.leafAsked)
          : -1;
      if (retiring !== -1) {
        owner = retiring;
        children[owner].leafAsked = true;
      }
      children[owner].channel.add(channel.id);
    } else if (entry.dir === "provider→bridge" && channel?.kind === "reply") {
      const asked = children.findLastIndex(
        (child) => child.leafAsked && child.channel.has(channel.id),
      );
      const any = children.findLastIndex((child) =>
        child.channel.has(channel.id),
      );
      owner = asked !== -1 ? asked : any !== -1 ? any : latest();
      children[owner].channel.delete(channel.id);
    }
    owners.set(index, owner);
  });
  return owners;
}

function movePiRetiringChildLines(dir) {
  const entries = LANES.flatMap((lane) => readLane(dir, lane)).sort(
    (left, right) => left.run - right.run || left.seq - right.seq,
  );
  const owners = piLineOwners(entries);
  const firstLine = new Map();
  entries.forEach((_, index) => {
    const owner = owners.get(index);
    if (owner !== undefined && !firstLine.has(owner))
      firstLine.set(owner, index);
  });
  const late = new Map();
  const kept = [];
  entries.forEach((entry, index) => {
    const owner = owners.get(index);
    const successorStart =
      owner === undefined ? undefined : firstLine.get(owner + 1);
    if (successorStart !== undefined && index > successorStart) {
      late.set(owner + 1, [...(late.get(owner + 1) ?? []), entry]);
    } else {
      kept.push({ entry, index });
    }
  });
  const moved = [...late.values()].reduce(
    (sum, lines) => sum + lines.length,
    0,
  );
  if (moved === 0) return;
  const reordered = [];
  for (const { entry, index } of kept) {
    for (const [child, start] of firstLine) {
      if (start === index && late.has(child))
        reordered.push(...late.get(child));
    }
    reordered.push(entry);
  }
  const seqs = entries
    .map((entry) => entry.seq)
    .sort((left, right) => left - right);
  const renumbered = reordered.map((entry, index) => ({
    ...entry,
    seq: seqs[index],
  }));
  for (const lane of LANES) {
    writeLane(
      dir,
      lane,
      renumbered
        .filter((entry) => entry.dir === lane)
        .sort((left, right) => left.run - right.run || left.seq - right.seq),
    );
  }
  updateManifest(dir, (manifest) =>
    addNote(
      manifest,
      `Moved ${moved} lines the bridge exchanged with a replaced pi child after its replacement spawned to just before the replacement, so each replay child gets its own process's lines.`,
    ),
  );
}

function redactHostname(dir) {
  const name = hostname();
  if (name === "") return;
  for (const lane of LANES) {
    const file = join(dir, `${lane}.ndjson`);
    if (!existsSync(file)) continue;
    const text = readFileSync(file, "utf8");
    if (text.includes(name))
      writeFileSync(file, text.split(name).join("host.local"));
  }
}

function withoutId(message) {
  const { id: _id, ...rest } = message;
  return JSON.stringify(rest);
}

function markProviderExit(dir, killedAt) {
  const lane = readLane(dir, "provider→bridge");
  const canonical = lane.map((entry) => {
    const message = parse(entry.line);
    return message === null || "id" in message ? null : withoutId(message);
  });
  let exit = null;
  lane.forEach((entry, index) => {
    if (entry.ts > killedAt || canonical[index] === null) return;
    if (canonical.filter((value) => value === canonical[index]).length === 1)
      exit = entry;
  });
  if (exit === null)
    throw new Error(`${dir}: no unique provider line before the kill`);
  updateManifest(dir, (manifest) => {
    manifest.providerExit = { run: exit.run, seq: exit.seq, signal: "SIGKILL" };
  });
}

function killedAt(notes) {
  const line = notes.log.find((entry) => entry.includes(" killed "));
  if (line === undefined)
    throw new Error(
      `${notes.providerId}/${notes.cell}: the notes record no kill`,
    );
  return Date.parse(line.split(" ")[0]);
}

const args = parseArgs(process.argv.slice(2));
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const scenariosRoot = join(
  repoRoot,
  "packages/provider-bridge-protocol/recordings/scenarios",
);
const staging = mkdtempSync(join(tmpdir(), "bb-scenario-cells-"));
const cells = [];
for (const cell of readdirSync(args.raw)) {
  if (!SCENARIO_CELLS.includes(cell)) continue;
  if (args.cells !== undefined && !args.cells.includes(cell)) continue;
  for (const file of readdirSync(join(args.raw, cell))) {
    if (!file.endsWith(".notes.json")) continue;
    const notes = JSON.parse(readFileSync(join(args.raw, cell, file), "utf8"));
    if (
      args.providers !== undefined &&
      !args.providers.includes(notes.providerId)
    )
      continue;
    mkdirSync(join(staging, "raw", notes.providerId), { recursive: true });
    symlinkSync(
      join(args.raw, cell, notes.providerId, notes.threadId),
      join(staging, "raw", notes.providerId, notes.threadId),
    );
    cells.push({ cell, notes });
  }
}
writeFileSync(
  join(staging, "cells.tsv"),
  cells
    .map(
      ({ cell, notes }) =>
        `${notes.providerId}\t${cell}\t${notes.threadId}\t\n`,
    )
    .join(""),
);
execFileSync(
  process.execPath,
  [
    join(repoRoot, "scripts/provider-recordings/package-cells.mjs"),
    "--raw",
    join(staging, "raw"),
    "--cells",
    join(staging, "cells.tsv"),
    "--out",
    join(staging, "out"),
    "--versions",
    JSON.stringify(args.versions),
  ],
  { stdio: "inherit" },
);
for (const { cell, notes } of cells) {
  const dir = join(staging, "out", notes.providerId, cell);
  redactHostname(dir);
  if (notes.providerId === "codex") trimCodexConfigRead(dir);
  if (notes.providerId === "claude-code") dropClaudeHookEchoes(dir);
  if (notes.providerId === "pi") movePiRetiringChildLines(dir);
  if (cell === "provider-exit") markProviderExit(dir, killedAt(notes));
  const target = join(scenariosRoot, notes.providerId, cell);
  rmSync(target, { recursive: true, force: true });
  cpSync(dir, target, { recursive: true });
  console.log(`packaged ${notes.providerId}/${cell}`);
}
rmSync(staging, { recursive: true, force: true });
