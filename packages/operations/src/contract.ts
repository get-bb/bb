export type CallerPrincipal = "owner" | "machine" | "system";

export interface OperationCaller {
  user: CallerPrincipal;
}

export type HttpDoorMethod = "get" | "post" | "patch" | "delete" | "put";

export interface HttpDoor {
  method: HttpDoorMethod;
  path: string;
  status: number;
  headers: Readonly<Record<string, string>>;
}

export interface Operation<Input = unknown> {
  readonly name: string;
  readonly http: HttpDoor;
  parse(raw: unknown): Input;
}
