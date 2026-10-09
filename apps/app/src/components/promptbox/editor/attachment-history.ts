import { Extension } from "@tiptap/core";
import type { Node } from "@tiptap/pm/model";
import { closeHistory } from "@tiptap/pm/history";
import type { Transaction } from "@tiptap/pm/state";
import { Step, StepMap, StepResult } from "@tiptap/pm/transform";
import { z } from "zod";

const ATTACHMENT_HISTORY_STEP_ID = "bbAttachmentHistory";
const attachmentHistoryStepSchema = z.object({
  id: z.string(),
  present: z.boolean(),
});

export class AttachmentHistoryStep extends Step {
  constructor(
    readonly id: string,
    readonly present: boolean,
  ) {
    super();
  }

  apply(doc: Node): StepResult {
    return StepResult.ok(doc);
  }

  getMap(): StepMap {
    return StepMap.empty;
  }

  invert(): Step {
    return new AttachmentHistoryStep(this.id, !this.present);
  }

  map(): Step {
    return this;
  }

  toJSON() {
    return {
      stepType: ATTACHMENT_HISTORY_STEP_ID,
      id: this.id,
      present: this.present,
    };
  }

  static fromJSON(_schema: unknown, json: unknown): AttachmentHistoryStep {
    const value = attachmentHistoryStepSchema.parse(json);
    return new AttachmentHistoryStep(value.id, value.present);
  }
}

Step.jsonID(ATTACHMENT_HISTORY_STEP_ID, AttachmentHistoryStep);

export const AttachmentHistory = Extension.create<{
  onChange: (id: string, present: boolean) => void;
}>({
  name: "attachmentHistory",
  addOptions() {
    return { onChange: () => {} };
  },
  onTransaction({ transaction }) {
    for (const step of transaction.steps) {
      if (step instanceof AttachmentHistoryStep) {
        this.options.onChange(step.id, step.present);
      }
    }
  },
});

export function attachmentHistoryTransaction(
  tr: Transaction,
  id: string,
  present: boolean,
): Transaction {
  return closeHistory(tr).step(new AttachmentHistoryStep(id, present));
}
