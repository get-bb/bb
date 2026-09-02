import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  REFUSAL_FALLBACK_RENDERER_ID,
  refusalFallbackResponseSchema,
  type RefusalFallbackOption,
  type RefusalFallbackPayload,
} from "./contracts.js";
import {
  inspectRefusalFallback,
  type RefusalFallbackCandidate,
} from "./recovery.js";

type ProviderModels = Awaited<
  ReturnType<BbPluginApi["sdk"]["providers"]["models"]>
>;
type AvailableModel = ProviderModels["models"][number];

export const MAX_OFFERED_MODELS = 3;
const PROMPT_TIMEOUT_MS = 10 * 60 * 1_000;

export type RefusalFallbackOutcome =
  | "declined"
  | "no-alternative"
  | "not-eligible"
  | "already-handled"
  | "switched";

const autoChoiceSchema = z.object({ model: z.string().min(1) });
export type RefusalFallbackAutoChoice = z.infer<typeof autoChoiceSchema>;

export function alternativeModels(
  models: readonly AvailableModel[],
  refusedModel: string,
): AvailableModel[] {
  const refusedIndex = models.findIndex((model) => model.id === refusedModel);
  const after = refusedIndex === -1 ? models : models.slice(refusedIndex + 1);
  return after
    .filter((model) => model.id !== refusedModel)
    .slice(0, MAX_OFFERED_MODELS);
}

export function modelLabel(
  models: readonly AvailableModel[],
  modelId: string,
): string {
  return models.find((model) => model.id === modelId)?.displayName ?? modelId;
}

function toOption(model: AvailableModel): RefusalFallbackOption {
  return {
    model: model.id,
    label: model.displayName,
    ...(model.description === "" ? {} : { description: model.description }),
  };
}

export function autoChoiceKey(providerId: string): string {
  return `auto:${providerId}`;
}

export class RefusalFallbackService {
  private readonly handledTurns = new Set<string>();
  private readonly inFlight = new Set<string>();

  constructor(private readonly bb: BbPluginApi) {}

  async forget(providerId: string): Promise<void> {
    await this.bb.storage.kv.delete(autoChoiceKey(providerId));
  }

  async autoChoice(
    providerId: string,
  ): Promise<RefusalFallbackAutoChoice | undefined> {
    const stored = await this.bb.storage.kv.get(autoChoiceKey(providerId));
    const parsed = autoChoiceSchema.safeParse(stored);
    return parsed.success ? parsed.data : undefined;
  }

  async reconcile(threadId: string): Promise<RefusalFallbackOutcome> {
    if (this.inFlight.has(threadId)) return "already-handled";
    this.inFlight.add(threadId);
    try {
      return await this.run(threadId);
    } finally {
      this.inFlight.delete(threadId);
    }
  }

  private async run(threadId: string): Promise<RefusalFallbackOutcome> {
    const inspection = await inspectRefusalFallback(this.bb, threadId);
    if (inspection.candidate === null) return "not-eligible";
    const { candidate, environmentId, providerId } = inspection;
    if (this.handledTurns.has(candidate.turnId)) return "already-handled";

    const catalog = await this.bb.sdk.providers.models({
      environmentId,
      providerId,
    });
    const alternatives = alternativeModels(
      catalog.models,
      candidate.refusedModel,
    );
    if (alternatives.length === 0) {
      this.handledTurns.add(candidate.turnId);
      this.bb.log.warn(
        `No fallback model is available after ${candidate.refusedModel} refused a turn in thread ${threadId}.`,
      );
      return "no-alternative";
    }

    const remembered = await this.autoChoice(providerId);
    const automatic =
      remembered !== undefined &&
      alternatives.some((model) => model.id === remembered.model)
        ? remembered.model
        : null;

    this.handledTurns.add(candidate.turnId);

    if (automatic !== null) {
      await this.switchAndContinue(threadId, automatic);
      return "switched";
    }

    const chosen = await this.ask(
      threadId,
      providerId,
      candidate,
      catalog.models,
      alternatives,
    );
    if (chosen === null) return "declined";
    await this.switchAndContinue(threadId, chosen);
    return "switched";
  }

  private async ask(
    threadId: string,
    providerId: string,
    candidate: RefusalFallbackCandidate,
    models: readonly AvailableModel[],
    alternatives: readonly AvailableModel[],
  ): Promise<string | null> {
    const payload: RefusalFallbackPayload = {
      refusedModelLabel: modelLabel(models, candidate.refusedModel),
      detail: candidate.detail,
      options: alternatives.map(toOption),
    };
    const result = await this.bb.ui.requestInput({
      threadId,
      rendererId: REFUSAL_FALLBACK_RENDERER_ID,
      title: `${payload.refusedModelLabel} refused this message`,
      payload,
      timeoutMs: PROMPT_TIMEOUT_MS,
    });
    if (result.outcome !== "submitted") return null;

    const parsed = refusalFallbackResponseSchema.safeParse(result.value);
    if (!parsed.success) return null;
    const { model, remember } = parsed.data;
    if (model === null) return null;
    if (!alternatives.some((entry) => entry.id === model)) return null;
    if (remember) {
      await this.bb.storage.kv.set(autoChoiceKey(providerId), { model });
    }
    return model;
  }

  private async switchAndContinue(
    threadId: string,
    model: string,
  ): Promise<void> {
    await this.bb.sdk.threads.update({ threadId, model });
    await this.bb.sdk.threads.send({
      threadId,
      mode: "start",
      input: [
        {
          type: "text",
          text: "Please continue.",
          mentions: [],
          visibility: "agent-only",
        },
      ],
    });
  }
}
