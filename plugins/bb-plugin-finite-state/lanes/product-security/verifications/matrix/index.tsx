import { useCallback, useEffect, useRef, useState } from "react";
import { useBbNavigate, useRealtime, useRpc } from "@bb/plugin-sdk/app";
import { z } from "zod";
import type { rpcContract } from "../../../../shared/contract.js";
import { aggregateCell } from "./aggregate.js";
import type { verificationMatrixPreferenceRpcContract } from "./backend.js";
import type { MatrixFilterValue } from "./MatrixFilters.js";
import { VerificationMatrixView, type MatrixViewState } from "./VerificationMatrix.js";
import {
  RESULT_STATES,
  VERIFICATION_TIERS,
  type MatrixRollup,
  type MatrixRow,
} from "./status.js";
import { mapCheckToTier } from "./tier-map.js";

const cellStateSchema = z.enum([...RESULT_STATES, "mapped_not_run", "unmapped"]);
const cellSchema = z.object({
  requirementId: z.string(),
  tier: z.enum(VERIFICATION_TIERS),
  state: cellStateSchema,
  checkCount: z.number().int().nonnegative(),
  requiredCount: z.number().int().nonnegative(),
  latestAt: z.string().nullable(),
  runIds: z.array(z.string()),
}).strict();
const cellsSchema = z.object({
  static: cellSchema,
  emulation: cellSchema,
  hil: cellSchema,
  manual: cellSchema,
  hardware: cellSchema,
}).strict();
const rowSchema = z.object({
  requirementId: z.string(),
  title: z.string(),
  pattern: z.string().nullable(),
  requirementType: z.string().nullable(),
  priority: z.string().nullable(),
  stale: z.boolean(),
  unknownCheckCount: z.number().int().nonnegative(),
  suppressedCheckCount: z.number().int().nonnegative(),
  cells: cellsSchema,
}).strict();
const rollupSchema = z.object({
  requirements: z.number().int().nonnegative(),
  verified: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  error: z.number().int().nonnegative(),
  inconclusive: z.number().int().nonnegative(),
  running: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
}).strict();
const fieldsSchema = z.object({
  row: rowSchema,
  rollup: rollupSchema,
}).strict();

function signalProjectId(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  const value = Reflect.get(payload, "projectId");
  return typeof value === "string" ? value : null;
}

function initialFilters(): MatrixFilterValue {
  return {
    text: "",
    tier: "all",
    status: "all",
    unprovenOnly: true,
    showManual: false,
  };
}

export function VerificationMatrix({ projectId }: { projectId: string }): React.JSX.Element {
  const rpc = useRpc<typeof rpcContract & typeof verificationMatrixPreferenceRpcContract>();
  const navigate = useBbNavigate();
  const [state, setState] = useState<MatrixViewState>(projectId ? "loading" : "unconfigured");
  const [rows, setRows] = useState<MatrixRow[]>([]);
  const [rollup, setRollup] = useState<MatrixRollup | null>(null);
  const [total, setTotal] = useState(0);
  const [next, setNext] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [filters, setFilters] = useState(initialFilters);
  const [revision, setRevision] = useState(0);
  const requestEpoch = useRef(0);
  const projectVersionId = useRef<string | null>(null);
  const loadedCount = useRef(200);
  const queryKey = `${projectId}:${filters.text}:${filters.tier}:${filters.status}:${filters.unprovenOnly}`;
  const previousQueryKey = useRef("");
  const running = rows.some((row) => VERIFICATION_TIERS.some((tier) => row.cells[tier].state === "running"));

  const load = useCallback(async (continuation: string | null, epoch: number, replaceLimit = 200) => {
    if (!projectId) return;
    if (continuation === null) setState("loading");
    try {
      const parsed: Array<z.infer<typeof fieldsSchema>> = [];
      let requestContinuation = continuation;
      let remaining = continuation === null ? replaceLimit : 200;
      let responseNext: string | null = null;
      let responseTotal = 0;
      let responseMessage: string | null = null;
      do {
        const input = {
          projectId,
          projectVersionId: projectVersionId.current,
          pageSize: Math.min(200, remaining),
          continuation: requestContinuation,
          filters: {
            text: filters.text,
            tier: filters.tier === "all" ? null : filters.tier,
            status: filters.status === "all" ? null : filters.status,
            unprovenOnly: filters.unprovenOnly,
          },
        };
        const page = await rpc.call("verificationsMatrix", input);
        if (requestEpoch.current !== epoch) return;
        const pageFields = page.items.map((item) => fieldsSchema.parse(item.fields));
        parsed.push(...pageFields);
        const resolvedVersion = page.items[0]?.projectVersionId;
        if (resolvedVersion !== undefined) projectVersionId.current = resolvedVersion;
        remaining -= pageFields.length;
        responseNext = page.next;
        responseTotal = page.total ?? pageFields.length;
        responseMessage = page.cache.message;
        if (continuation !== null || page.next === null || pageFields.length === 0) break;
        requestContinuation = page.next;
      } while (remaining > 0);
      setRows((current) => {
        const nextRows = continuation === null
          ? parsed.map((item) => item.row)
          : [...current, ...parsed.map((item) => item.row).filter((row) =>
            !current.some((existing) => existing.requirementId === row.requirementId),
          )];
        loadedCount.current = Math.max(200, nextRows.length);
        return nextRows;
      });
      if (continuation === null || parsed.length > 0) {
        setRollup(parsed[0]?.rollup ?? null);
        setTotal(responseTotal);
      }
      setNext(responseNext);
      setMessage(responseMessage);
      setState("ready");
    } catch (error) {
      if (requestEpoch.current !== epoch) return;
      setMessage(error instanceof Error ? error.message : "Verification evidence could not be read.");
      setState("error");
    }
  }, [filters.status, filters.text, filters.tier, filters.unprovenOnly, projectId, rpc]);

  useEffect(() => {
    projectVersionId.current = null;
    if (!projectId) return;
    void rpc.call("verificationMatrixPreferenceGet", { projectId }).then(({ showManual }) => {
      setFilters((current) => current.showManual === showManual
        ? current
        : { ...current, showManual });
    }).catch(() => {
      setMessage("The manual-column preference could not be read.");
    });
  }, [projectId, rpc]);

  useEffect(() => {
    const epoch = ++requestEpoch.current;
    const filtersChanged = previousQueryKey.current !== queryKey;
    previousQueryKey.current = queryKey;
    if (filtersChanged) loadedCount.current = 200;
    const replaceLimit = filtersChanged ? 200 : loadedCount.current;
    const timer = window.setTimeout(
      () => void load(null, epoch, replaceLimit),
      filters.text ? 180 : 0,
    );
    return () => {
      window.clearTimeout(timer);
      if (requestEpoch.current === epoch) requestEpoch.current += 1;
    };
  }, [load, queryKey, revision, filters.text]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setRevision((value) => value + 1), 5_000);
    return () => window.clearInterval(timer);
  }, [running]);

  useRealtime("verifications:changed", (payload) => {
    if (signalProjectId(payload) === projectId) setRevision((value) => value + 1);
  });

  return (
    <VerificationMatrixView
      filters={filters}
      hasNextPage={next !== null}
      message={message}
      onFiltersChange={(nextFilters) => {
        if (nextFilters.showManual !== filters.showManual) {
          void rpc.call("verificationMatrixPreferenceSet", {
            projectId,
            showManual: nextFilters.showManual,
          }).catch(() => {
            setMessage("The manual-column preference could not be saved.");
          });
        }
        setFilters(nextFilters);
      }}
      onLoadMore={() => {
        if (next) void load(next, requestEpoch.current);
      }}
      onOpenCell={(requirementId, tier) => navigate.toPluginPanel("product-security", {
        subPath: `verifications/${requirementId}/${tier}`,
      })}
      onRefresh={() => setRevision((value) => value + 1)}
      rollup={rollup}
      rows={rows}
      state={state}
      total={total}
    />
  );
}

export { aggregateCell, mapCheckToTier };
export type {
  MatrixCellState,
  MatrixRow,
  VerificationCell,
  VerificationTier,
} from "./status.js";
export type { CheckModel } from "./tier-map.js";
export type { VerificationResult } from "./aggregate.js";
