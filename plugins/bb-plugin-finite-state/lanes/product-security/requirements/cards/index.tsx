import { useCallback, useEffect, useRef, useState } from "react";
import { useBbContext, useRealtime, useRpc } from "@bb/plugin-sdk/app";
import type { RpcContract } from "../../../../shared/contract.js";
import { RequirementList, type RequirementListState } from "./RequirementList.js";
import { requirementCardModelSchema, type RequirementCardModel } from "./schema.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function payloadProjectId(value: unknown): string | null {
  if (!isRecord(value)) return null;
  return typeof value.projectId === "string" ? value.projectId : null;
}

export function RequirementsCards(): React.JSX.Element {
  const { projectId } = useBbContext();
  const rpc = useRpc<RpcContract>();
  const [state, setState] = useState<RequirementListState>(projectId ? "loading" : "unconfigured");
  const [models, setModels] = useState<RequirementCardModel[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [projectVersionId, setProjectVersionId] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const projectVersionIdRef = useRef<string | null>(null);
  const requestEpoch = useRef(0);

  const load = useCallback(async (continuation: string | null, epoch: number, refresh = false) => {
    if (!projectId) return;
    if (continuation === null) setState("loading");
    const request = {
      projectId,
      projectVersionId: projectVersionIdRef.current,
      pageSize: 100,
      continuation,
      filters: refresh ? { refresh: true } : {},
      };
    try {
      const page = await rpc.call("requirementsList", request);
      if (requestEpoch.current !== epoch) return;
      const pageModels = page.items.map((item) => requirementCardModelSchema.parse(item.fields));
      const resolvedVersionId = page.items[0]?.projectVersionId;
      if (resolvedVersionId !== undefined) {
        projectVersionIdRef.current = resolvedVersionId;
        setProjectVersionId(resolvedVersionId);
      }
      setModels((current) => continuation === null
        ? pageModels
        : [...current, ...pageModels.filter((nextModel) =>
            !current.some((currentModel) => currentModel.requirement.id === nextModel.requirement.id),
          )]);
      setNext(page.next);
      setMessage(page.cache.message);
      setState("ready");
    } catch (error) {
      if (requestEpoch.current !== epoch) return;
      setMessage(error instanceof Error ? error.message : "Requirements could not be read.");
      setState("error");
    }
  }, [projectId, rpc]);

  useRealtime("requirements:changed", (payload) => {
    if (projectId && payloadProjectId(payload) === projectId) setRevision((value) => value + 1);
  });

  useEffect(() => {
    const epoch = ++requestEpoch.current;
    if (projectId) {
      queueMicrotask(() => {
        if (requestEpoch.current === epoch) void load(null, epoch, revision > 0);
      });
    }
    return () => {
      if (requestEpoch.current === epoch) requestEpoch.current += 1;
    };
  }, [load, projectId, revision]);

  return (
    <section className="h-full min-h-0 bg-background text-foreground" aria-label="EARS requirements">
      <RequirementList
        hasNextPage={next !== null}
        message={message}
        models={projectId ? models : []}
        onLoadMore={() => void load(next, requestEpoch.current)}
        onRefresh={() => {
          const epoch = ++requestEpoch.current;
          void load(null, epoch, true);
        }}
        state={projectId ? state : "unconfigured"}
        projectVersionId={projectVersionId}
      />
    </section>
  );
}
