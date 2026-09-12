import { createHash } from "node:crypto";
export type RewardKind = "test_execution" | "diff_similarity";
export interface Reproducibility {
    readonly mode: "local_only" | "registry" | "inline_dockerfile";
    readonly imageRef: string;
    readonly imageTag: string;
    readonly imageVisibility: "public" | "private";
}
export interface HarborTask {
    readonly name: string;
    readonly org: string;
    readonly description: string;
    readonly instruction: string;
    readonly oracleDiff: string;
    readonly difficulty?: string;
    readonly category?: string;
    readonly keywords?: readonly string[];
    readonly provenance?: Readonly<Record<string, string | number | boolean>>;
    readonly environmentDockerfile?: string;
    readonly testScript?: string;
    readonly auxFiles?: Readonly<Record<string, string>>;
    readonly agentTimeoutSec?: number;
    readonly verifierTimeoutSec?: number;
}
export interface EmittedFile {
    readonly path: string;
    readonly content: string;
    readonly mode: number;
}
export class HarborEmitError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "HarborEmitError";
    }
}
export function contentHash(task: Pick<HarborTask, "instruction" | "oracleDiff">): string {
    const h = createHash("sha256");
    h.update(Buffer.from(task.instruction, "utf8"));
    h.update(Buffer.from([0]));
    h.update(Buffer.from(task.oracleDiff, "utf8"));
    return `sha256:${h.digest("hex")}`;
}
const SPEC_VERSION = "0.2.0";
const FROM_LINE = /^\s*FROM\s+(\S+)/im;
function tomlString(value: string): string {
    const escaped = value
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\n/g, "\\n")
        .replace(/\r/g, "\\r")
        .replace(/\t/g, "\\t");
    return `"${escaped}"`;
}
function tomlValue(value: string | number | boolean | readonly string[]): string {
    if (typeof value === "string")
        return tomlString(value);
    if (typeof value === "number" || typeof value === "boolean")
        return String(value);
    return `[${value.map(tomlString).join(", ")}]`;
}
function tomlTable(header: string, entries: ReadonlyArray<readonly [
    string,
    string | number | boolean | readonly string[]
]>): string {
    const lines = [`[${header}]`];
    for (const [key, value] of entries)
        lines.push(`${key} = ${tomlValue(value)}`);
    return lines.join("\n");
}
export function seedReproducibility(dockerfile: string): Reproducibility {
    const match = FROM_LINE.exec(dockerfile);
    const image = match?.[1]?.trim() ?? "local/r2e-bootstrap:unknown";
    return {
        mode: "local_only",
        imageRef: image,
        imageTag: image,
        imageVisibility: "private",
    };
}
export function renderTaskToml(task: HarborTask): string {
    if (!task.name)
        throw new HarborEmitError("task.name is required");
    if (!task.org)
        throw new HarborEmitError("task.org is required");
    if (task.name.includes("/")) {
        throw new HarborEmitError(`task.name must be a filesystem-safe slug without "/", got "${task.name}"`);
    }
    const rewardKinds: readonly RewardKind[] = task.testScript !== undefined
        ? ["test_execution", "diff_similarity"]
        : ["diff_similarity"];
    const blocks: string[] = [
        'version = "1.0"',
        "",
        tomlTable("task", [
            ["name", `${task.org}/${task.name}`],
            ["description", task.description],
        ]),
        "",
        tomlTable("metadata", [
            ["difficulty", task.difficulty ?? "medium"],
            ["category", task.category ?? "bugfix"],
            ["keywords", task.keywords ?? []],
        ]),
        "",
    ];
    const repo2env: Array<readonly [
        string,
        string | number | boolean | readonly string[]
    ]> = [
        ["spec_version", SPEC_VERSION],
        ["content_hash", contentHash(task)],
        ["reward_kinds", rewardKinds],
    ];
    for (const [key, value] of Object.entries(task.provenance ?? {})) {
        repo2env.push([key, value]);
    }
    blocks.push(tomlTable("metadata.repo2env", repo2env), "");
    if (task.environmentDockerfile !== undefined) {
        const repro = seedReproducibility(task.environmentDockerfile);
        blocks.push(tomlTable("metadata.repo2env.reproducibility", [
            ["mode", repro.mode],
            ["image_ref", repro.imageRef],
            ["image_tag", repro.imageTag],
            ["image_visibility", repro.imageVisibility],
        ]), "");
    }
    blocks.push(tomlTable("agent", [["timeout_sec", task.agentTimeoutSec ?? 1800.0]]), "", tomlTable("verifier", [["timeout_sec", task.verifierTimeoutSec ?? 300.0]]), "");
    return blocks.join("\n");
}
const SOLVE_SH = `#!/bin/bash
set -euxo pipefail
cd /workspace
git config --global --add safe.directory /workspace
PATCH="$(dirname "$0")/patch.diff"
git apply --verbose --reject "$PATCH"
`;
export function emitHarborTask(task: HarborTask): EmittedFile[] {
    const dir = task.name;
    const files: EmittedFile[] = [
        { path: `${dir}/task.toml`, content: renderTaskToml(task), mode: 0o644 },
        { path: `${dir}/instruction.md`, content: task.instruction, mode: 0o644 },
        { path: `${dir}/solution/patch.diff`, content: task.oracleDiff, mode: 0o644 },
        { path: `${dir}/solution/solve.sh`, content: SOLVE_SH, mode: 0o755 },
    ];
    if (task.environmentDockerfile !== undefined) {
        files.push({
            path: `${dir}/environment/Dockerfile`,
            content: task.environmentDockerfile,
            mode: 0o644,
        });
    }
    if (task.testScript !== undefined) {
        files.push({ path: `${dir}/tests/test.sh`, content: task.testScript, mode: 0o755 });
    }
    for (const [rel, content] of Object.entries(task.auxFiles ?? {})) {
        const normalized = rel.replace(/\\/g, "/");
        if (normalized.startsWith("/") ||
            normalized.split("/").some((segment) => segment === "..")) {
            throw new HarborEmitError(`aux_file path escapes task dir: ${rel}`);
        }
        files.push({ path: `${dir}/${normalized}`, content, mode: 0o644 });
    }
    return files;
}
