export interface BbHttpErrorArgs {
  body: unknown;
  code: string | null;
  message: string;
  status: number;
}

const httpErrorBrand = Symbol.for("@bb/sdk/http-error");

/**
 * A non-2xx response from the bb server API. `status` is the HTTP status,
 * `code` the server's error code (`thread_not_found`, `forbidden`, ...) when
 * the body carried one, and `body` the parsed response body. `instanceof`
 * recognizes errors thrown by any copy of the SDK, so a plugin's bundled copy
 * matches the errors `bb.sdk` throws from the host.
 */
export class BbHttpError extends Error {
  static [Symbol.hasInstance](value: unknown): boolean {
    return (
      typeof value === "object" &&
      value !== null &&
      Reflect.get(value, httpErrorBrand) === true
    );
  }
  readonly body: unknown;
  readonly code: string | null;
  readonly status: number;

  constructor(args: BbHttpErrorArgs) {
    super(`HTTP ${args.status}: ${args.message}`);
    Object.defineProperty(this, httpErrorBrand, { value: true });
    this.name = "BbHttpError";
    this.body = args.body;
    this.code = args.code;
    this.status = args.status;
  }
}
