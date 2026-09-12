import { contentHash, type HarborTask } from "../harbor/harbor.ts";
export interface ProbeResult {
    readonly failToPass: Readonly<Record<string, boolean>>;
    readonly passToPass: Readonly<Record<string, boolean>>;
    readonly verifierErrored?: boolean;
    readonly detail?: string;
}
export interface TaskProposal {
    readonly task: HarborTask;
    readonly authoredBy: string;
    readonly baseProbe: ProbeResult;
    readonly oracleProbe: ProbeResult;
}
export type RejectionCode = "verifier_errored" | "no_f2p_tests" | "trivially_passing" | "oracle_fails" | "oracle_regresses" | "empty_oracle_diff" | "missing_instruction";
export interface Rejection {
    readonly code: RejectionCode;
    readonly message: string;
}
export interface Admission {
    readonly admitted: boolean;
    readonly rejections: readonly Rejection[];
    readonly contentHash: string;
    readonly baseReward: number;
    readonly oracleReward: number;
}
function rate(results: Readonly<Record<string, boolean>>): number {
    const keys = Object.keys(results);
    if (keys.length === 0)
        return 1;
    let passed = 0;
    for (const key of keys)
        if (results[key] === true)
            passed += 1;
    return passed / keys.length;
}
export function probeReward(probe: ProbeResult): number {
    return rate(probe.failToPass) * rate(probe.passToPass);
}
export function admitTask(proposal: TaskProposal): Admission {
    const rejections: Rejection[] = [];
    const { task, baseProbe, oracleProbe } = proposal;
    if (task.instruction.trim() === "") {
        rejections.push({
            code: "missing_instruction",
            message: "instruction is empty; there is no task to perform",
        });
    }
    if (task.oracleDiff.trim() === "") {
        rejections.push({
            code: "empty_oracle_diff",
            message: "oracle diff is empty; nothing demonstrates the task is solvable",
        });
    }
    if (baseProbe.verifierErrored === true || oracleProbe.verifierErrored === true) {
        const which = baseProbe.verifierErrored === true ? "base" : "oracle";
        const detail = (baseProbe.verifierErrored === true ? baseProbe.detail : oracleProbe.detail) ??
            "no detail";
        rejections.push({
            code: "verifier_errored",
            message: `the ${which} verifier run did not complete (${detail}); its result cannot be trusted`,
        });
    }
    const f2pCount = Object.keys(baseProbe.failToPass).length;
    if (f2pCount === 0) {
        rejections.push({
            code: "no_f2p_tests",
            message: "no fail-to-pass tests; nothing distinguishes a solution from a no-op",
        });
    }
    const baseReward = probeReward(baseProbe);
    const oracleReward = probeReward(oracleProbe);
    const alreadyPassing = Object.entries(baseProbe.failToPass)
        .filter(([, passed]) => passed)
        .map(([id]) => id);
    if (alreadyPassing.length > 0) {
        rejections.push({
            code: "trivially_passing",
            message: `fail-to-pass tests already pass on the base repo: ${alreadyPassing.join(", ")}`,
        });
    }
    const oracleFailures = Object.entries(oracleProbe.failToPass)
        .filter(([, passed]) => !passed)
        .map(([id]) => id);
    if (oracleFailures.length > 0) {
        rejections.push({
            code: "oracle_fails",
            message: `the oracle patch does not make these pass: ${oracleFailures.join(", ")}`,
        });
    }
    const regressions = Object.entries(oracleProbe.passToPass)
        .filter(([, passed]) => !passed)
        .map(([id]) => id);
    if (regressions.length > 0) {
        rejections.push({
            code: "oracle_regresses",
            message: `the oracle patch regresses pass-to-pass tests: ${regressions.join(", ")}`,
        });
    }
    return {
        admitted: rejections.length === 0,
        rejections,
        contentHash: contentHash({ instruction: task.instruction, oracleDiff: task.oracleDiff }),
        baseReward,
        oracleReward,
    };
}
export interface AdmittedTask {
    readonly proposal: TaskProposal;
    readonly admission: Admission;
}
export interface BatchReport {
    readonly admitted: readonly AdmittedTask[];
    readonly rejected: readonly AdmittedTask[];
    readonly duplicates: readonly AdmittedTask[];
    readonly admissionRate: number;
}
export function screenBatch(proposals: readonly TaskProposal[]): BatchReport {
    const admitted: AdmittedTask[] = [];
    const rejected: AdmittedTask[] = [];
    const duplicates: AdmittedTask[] = [];
    const seen = new Set<string>();
    for (const proposal of proposals) {
        const admission = admitTask(proposal);
        const entry = { proposal, admission };
        if (!admission.admitted) {
            rejected.push(entry);
            continue;
        }
        if (seen.has(admission.contentHash)) {
            duplicates.push(entry);
            continue;
        }
        seen.add(admission.contentHash);
        admitted.push(entry);
    }
    const total = proposals.length;
    return {
        admitted,
        rejected,
        duplicates,
        admissionRate: total === 0 ? 0 : admitted.length / total,
    };
}
export function feedbackFor(admission: Admission): string {
    if (admission.admitted)
        return "admitted";
    return admission.rejections.map((r) => `[${r.code}] ${r.message}`).join("\n");
}
