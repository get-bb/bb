#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const TEST_SEGMENTS = new Set([
  "test",
  "tests",
  "testing",
  "__tests__",
  "fixtures",
  "test-helpers",
]);
const TEST_BASENAME_RE =
  /\.(?:test|spec|e2e)\.[cm]?[jt]sx?$|test-support|test-helpers|test-fixture|fixture|global-setup/u;
const SOURCE_RE = /\.[cm]?[jt]sx?$/u;
const PID_NAME_RE =
  /(?:^|[^A-Za-z0-9_$.])(?:pids?|[A-Za-z0-9_$]*Pids?)\b(?![.-])|\.pid\b(?![.\-"'`])/u;

const OWNER_FILES = new Set([
  "packages/test-helpers/src/child-processes.ts",
  "packages/test-helpers/src/process-sweep.ts",
]);
const PID_FILE_RE = /pid(?:File|Path)\b/iu;
const IDENTITY_FIELD_RE = /\b(?:lstart|etimes?|start)=?/u;
const HANDLE_ADVICE =
  "Observe the owned ChildProcess (trackChildProcesses() from @bb/test-helpers), a lifeline or descendant pipe the process holds (createProcessLifeline(), createDescendantPipe()), or a recorded identity (readProcessIdentity() from @bb/process-utils).";

const mentionsPid = (text) => PID_NAME_RE.test(text) && !isOwnPid(text);
const isOwnPid = (text) => /^\s*process\.p?pid\s*$/u.test(text);

const RULES = [
  {
    id: "signal-zero-probe",
    message: `Signal 0 (kill(pid, 0), kill -0) asks whether some process holds this PID now, not whether the test's process is alive; PIDs are reused, quickly on Windows. ${HANDLE_ADVICE}`,
    find(source) {
      return [
        ...calls(source, /\bkill\s*\(/gu).filter(
          (call) => call.args.length >= 2 && call.args.at(-1).trim() === "0",
        ),
        ...matchAll(source, /\bkill\s+(?:-0|-s\s+0)\b/gu),
      ];
    },
  },
  {
    id: "pid-liveness-helper",
    message: `A liveness helper given a PID answers for whichever process holds that PID now. ${HANDLE_ADVICE}`,
    find(source) {
      return [
        ...calls(
          source,
          /\b[A-Za-z0-9_$]*(?:[Aa]live|[Rr]unning)\s*\(/gu,
        ).filter(
          (call) => mentionsPid(call.argText) || PID_FILE_RE.test(call.argText),
        ),
        ...calls(source, /\b[A-Za-z0-9_$]*[Ee]xists?\s*\(/gu).filter((call) =>
          mentionsPid(call.argText),
        ),
        ...matchAll(
          source,
          /\.(?:some|every|filter|find|findIndex)\(\s*[A-Za-z0-9_$]*(?:[Aa]live|[Rr]unning|[Ee]xists?)\s*\)/gu,
        ),
      ];
    },
  },
  {
    id: "pid-os-probe",
    message: `Reading /proc/<pid> or asking ps about a PID describes whichever process holds that PID now. ${HANDLE_ADVICE} A ps call that reads a start time (lstart, etime) to compare identities is allowed.`,
    find(source) {
      const procPaths = [
        ...matchAll(
          source,
          /\/proc\/(?:\$\{([^}]*)\}|["'`]\s*\+\s*([A-Za-z0-9_$.()]+))/gu,
        ),
        ...matchAll(source, /["'`]\/proc["'`]\s*,\s*([^,)]+)/gu),
      ].filter((match) =>
        match.groups.some((group) => group && mentionsPid(group)),
      );
      const psArrays = matchAll(
        source,
        /["'`]ps["'`]\s*,\s*\[([^\]]*)\]/gu,
      ).filter(
        (match) =>
          /["'`]-p["'`]/u.test(match.groups[0]) &&
          !IDENTITY_FIELD_RE.test(match.groups[0]) &&
          !/["'`]-p["'`]\s*,\s*String\(\s*process\.p?pid\s*\)/u.test(
            match.groups[0],
          ),
      );
      const psCommands = matchAll(
        source,
        /\bps\s+(?:-[A-Za-z]+\s+)*[^|;&\n"'`]*?-p\b[^|;&\n"'`]*/gu,
      ).filter((match) => !IDENTITY_FIELD_RE.test(match.text));
      return [...procPaths, ...psArrays, ...psCommands];
    },
  },
  {
    id: "pid-identity-assertion",
    message:
      "A restarted process can receive the PID of the one it replaced. Compare an identity the process reports itself (for example a boot id), the ChildProcess objects from trackChildProcesses(), or lifeline holders.",
    find(source) {
      const negated = matchAll(
        source,
        /expect\(\s*([^;]*?)\)\s*\.not\s*\.to(?:Be|Equal|StrictEqual|Contain)\(\s*([^;]*?)\)/gu,
      ).filter(
        (match) =>
          !isOwnPid(match.groups[0]) &&
          !isOwnPid(match.groups[1]) &&
          (mentionsPid(match.groups[0]) || mentionsPid(match.groups[1])),
      );
      const compared = calls(source, /\bexpect\s*\(/gu).filter((call) => {
        const parts = call.argText.split(/[!=]==/u);
        return (
          parts.length === 2 &&
          parts.every((part) => !isOwnPid(part)) &&
          parts.some(mentionsPid)
        );
      });
      return [...negated, ...compared];
    },
  },
  {
    id: "pid-signal",
    message:
      "Signalling a remembered PID can hit whichever process holds it now; a failed spawn's `pid ?? 0` signals the whole process group. Signal through the handle: child.kill() or killProcessGroup({ child }) from @bb/process-utils, holder.kill() or tracker.killRunning() from @bb/test-helpers, or stopVerifiedProcess() from @bb/config for a process identified by start time.",
    find(source) {
      return calls(source, /\bprocess\.kill\s*\(/gu).filter(
        (call) =>
          call.args.length >= 1 &&
          !isOwnPid(call.args[0]) &&
          !(call.args.length >= 2 && call.args.at(-1).trim() === "0"),
      );
    },
  },
];

function matchAll(source, re) {
  return [...source.matchAll(re)].map((match) => ({
    index: match.index,
    text: match[0],
    groups: match.slice(1),
  }));
}

const CLOSERS = { "(": ")", "[": "]", "{": "}" };

function calls(source, calleeRe) {
  return matchAll(source, calleeRe).flatMap((match) => {
    const open = match.index + match.text.length - 1;
    const stack = [];
    const args = [];
    let argStart = open + 1;
    let quote = null;
    for (let index = open; index < source.length; index += 1) {
      const char = source[index];
      if (quote !== null) {
        if (char === "\\") index += 1;
        else if (char === quote) quote = null;
        continue;
      }
      if (char === '"' || char === "'" || char === "`") {
        quote = char;
      } else if (char in CLOSERS) {
        stack.push(CLOSERS[char]);
      } else if (char === ")" || char === "]" || char === "}") {
        if (stack.pop() !== char) return [];
        if (stack.length === 0) {
          args.push(source.slice(argStart, index));
          const argText = source.slice(open + 1, index);
          return [
            {
              index: match.index,
              text: source.slice(match.index, index + 1),
              args: args.filter(
                (arg, position) =>
                  position < args.length - 1 || arg.trim() !== "",
              ),
              argText,
            },
          ];
        }
      } else if (char === "," && stack.length === 1) {
        args.push(source.slice(argStart, index));
        argStart = index + 1;
      }
    }
    return [];
  });
}

export function isTestSource(path) {
  if (!SOURCE_RE.test(path)) return false;
  const segments = path.split("/");
  const basename = segments.at(-1);
  if (segments.includes("node_modules")) return false;
  return (
    segments.slice(0, -1).some((segment) => TEST_SEGMENTS.has(segment)) ||
    TEST_BASENAME_RE.test(basename)
  );
}

export function findProcessIdentityChecks(source) {
  const lineStarts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") lineStarts.push(index + 1);
  }
  const lineOf = (offset) => {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (lineStarts[mid] <= offset) low = mid;
      else high = mid - 1;
    }
    return low + 1;
  };
  return RULES.flatMap((rule) =>
    rule.find(source).map((match) => ({
      rule: rule.id,
      message: rule.message,
      line: lineOf(match.index),
      text: match.text.replace(/\s+/gu, " "),
    })),
  ).sort((a, b) => a.line - b.line);
}

export function scanFiles(root, paths) {
  return paths
    .filter((path) => isTestSource(path) && !OWNER_FILES.has(path))
    .flatMap((path) =>
      findProcessIdentityChecks(readFileSync(join(root, path), "utf8")).map(
        (finding) => ({ path, ...finding }),
      ),
    );
}

function trackedFiles(root) {
  return execFileSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  })
    .split("\0")
    .filter(Boolean);
}

function main() {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const findings = scanFiles(root, trackedFiles(root));
  if (findings.length === 0) return;
  for (const finding of findings) {
    console.error(
      `${finding.path}:${finding.line}: [${finding.rule}] ${finding.text}`,
    );
  }
  const messages = new Map(
    findings.map((finding) => [finding.rule, finding.message]),
  );
  console.error("");
  for (const [rule, message] of messages) console.error(`${rule}: ${message}`);
  process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
