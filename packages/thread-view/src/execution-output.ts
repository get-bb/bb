import {
  createVisibleTextBuffer,
  type VisibleTextBuffer,
} from "./visible-text-buffer.js";

interface ExecutionOutputValue {
  output: string;
  outputBuffer: VisibleTextBuffer;
}

export class ExecutionOutputQueue {
  private updates: (() => void)[] = [];

  enqueue(update: () => void): void {
    this.updates.push(update);
  }

  flush(): void {
    for (const update of this.updates) update();
    this.updates = [];
  }

  create(): ExecutionOutput {
    return new ExecutionOutput(this);
  }
}

export class ExecutionOutput {
  private readonly value: ExecutionOutputValue = {
    output: "",
    outputBuffer: createVisibleTextBuffer(),
  };

  constructor(private readonly queue: ExecutionOutputQueue) {}

  update(update: (value: ExecutionOutputValue) => void): void {
    this.queue.enqueue(() => update(this.value));
  }

  with(
    other: ExecutionOutput,
    update: (value: ExecutionOutputValue, other: ExecutionOutputValue) => void,
  ): void {
    this.queue.enqueue(() => update(this.value, other.value));
  }

  mergeText(
    other: ExecutionOutput | string,
    update: (value: ExecutionOutputValue, text: string) => void,
  ): void {
    this.queue.enqueue(() =>
      update(
        this.value,
        typeof other === "string" ? other : other.value.output,
      ),
    );
  }

  copy(): ExecutionOutput {
    const copy = this.queue.create();
    copy.mergeText(this, (value, text) => {
      value.output = text;
    });
    return copy;
  }

  read(): string {
    this.queue.flush();
    return this.value.output;
  }
}
