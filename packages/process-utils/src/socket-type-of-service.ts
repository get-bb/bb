import { Socket } from "node:net";

function isEinvalError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EINVAL";
}

export function installSocketTypeOfServiceGuard(): void {
  const setTypeOfService: unknown = Reflect.get(
    Socket.prototype,
    "setTypeOfService",
  );
  if (typeof setTypeOfService !== "function") {
    return;
  }
  Reflect.set(
    Socket.prototype,
    "setTypeOfService",
    function (this: Socket, tos: number): Socket {
      try {
        return Reflect.apply(setTypeOfService, this, [tos]);
      } catch (error) {
        if (isEinvalError(error)) {
          return this;
        }
        throw error;
      }
    },
  );
}
