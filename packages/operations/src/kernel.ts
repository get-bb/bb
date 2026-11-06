import type { Operation, OperationCaller } from "./contract.js";

export type OperationErrorCode = "invalid_input" | "unimplemented";

export class OperationError extends Error {
  readonly code: OperationErrorCode;

  constructor(code: OperationErrorCode, message: string) {
    super(message);
    this.name = "OperationError";
    this.code = code;
  }
}

export interface CallContext<Http> {
  caller: OperationCaller;
  signal: AbortSignal;
  http: Http | null;
}

export type Implementation<Input, Output, Http> = (
  input: Input,
  context: CallContext<Http>,
) => Output | Promise<Output>;

export interface CallOptions<Http> {
  caller: OperationCaller;
  signal?: AbortSignal;
  http?: Http;
}

export interface OperationKernel<Http> {
  define(operation: Operation): void;
  implement<Input, Output>(
    operation: Operation<Input>,
    implementation: Implementation<Input, Output, Http>,
  ): void;
  call(
    operation: Operation,
    input: unknown,
    options: CallOptions<Http>,
  ): Promise<unknown>;
  unimplemented(): string[];
}

export function createOperationKernel<Http>(): OperationKernel<Http> {
  const defined = new Map<string, Operation>();
  const implementations = new Map<
    string,
    Implementation<unknown, unknown, Http>
  >();
  const neverAborted = new AbortController().signal;
  return {
    define(operation) {
      const known = defined.get(operation.name);
      if (known !== undefined && known !== operation) {
        throw new Error(`${operation.name} is already defined`);
      }
      defined.set(operation.name, operation);
    },
    implement(operation, implementation) {
      if (implementations.has(operation.name)) {
        throw new Error(`${operation.name} is already implemented`);
      }
      defined.set(operation.name, operation);
      implementations.set(
        operation.name,
        implementation as Implementation<unknown, unknown, Http>,
      );
    },
    async call(operation, input, options) {
      const implementation = implementations.get(operation.name);
      if (implementation === undefined) {
        throw new OperationError(
          "unimplemented",
          `Nothing implements ${operation.name}`,
        );
      }
      return implementation(operation.parse(input), {
        caller: options.caller,
        signal: options.signal ?? neverAborted,
        http: options.http ?? null,
      });
    },
    unimplemented() {
      return [...defined.keys()]
        .filter((name) => !implementations.has(name))
        .sort();
    },
  };
}
