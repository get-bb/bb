export class PersistedHostAuthRejectedError extends Error {
  constructor(rejection: Error) {
    super(
      `The server rejected the host key saved in auth.json: ${rejection.message}`,
      { cause: rejection },
    );
    this.name = "PersistedHostAuthRejectedError";
  }
}
