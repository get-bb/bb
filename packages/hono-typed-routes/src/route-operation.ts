import type { ZodError } from "zod";
import type { Endpoint } from "./endpoint.js";
import type {
  AnyRouteResponseDescriptor,
  EndpointFromRouteDescriptor,
  JsonRouteRequest,
  RouteDefinition,
  RouteParams,
  RouteRequestInput,
} from "./route-descriptor.js";

type RouteParam<Descriptor extends RouteDefinition> = RouteParams<
  Descriptor["path"]
>;

type RouteBody<Request> =
  Request extends JsonRouteRequest<any, infer Parsed, infer Field>
    ? Field extends string
      ? { [Key in Field]: Parsed }
      : Parsed
    : Request extends { source: "query"; readonly parsedInput?: infer Parsed }
      ? Parsed
      : Request extends { source: "form"; readonly input?: infer Input }
        ? Input extends { form: infer Form }
          ? Form
          : Record<never, never>
        : Record<never, never>;

type NoFields<Body> = string extends keyof Body
  ? Body[string] extends never
    ? Record<never, never>
    : Body
  : Body;

export type RouteOperationInput<Descriptor extends RouteDefinition> =
  RouteParam<Descriptor> & NoFields<RouteBody<Descriptor["request"]>>;

type RouteCallBody<Request> =
  RouteRequestInput<Request> extends infer Input
    ? Input extends { json: infer Json }
      ? Request extends { field: infer Field extends string }
        ? { [Key in Field]: Json }
        : Json
      : Input extends { query: infer Query }
        ? Query
        : Input extends { query?: infer Query }
          ? Partial<NonNullable<Query>>
          : Input extends { form: infer Form }
            ? Form
            : Record<never, never>
    : Record<never, never>;

export type RouteCallInput<Descriptor extends RouteDefinition> =
  RouteParam<Descriptor> & NoFields<RouteCallBody<Descriptor["request"]>>;

type SuccessStatus = 200 | 201 | 202 | 204;

export type RouteOperationOutput<Descriptor extends RouteDefinition> =
  EndpointFromRouteDescriptor<Descriptor> extends infer Variant
    ? Variant extends Endpoint<any, infer Output, infer Status, any>
      ? Status extends SuccessStatus
        ? Output
        : never
      : never
    : never;

export function routeSuccessStatus(descriptor: RouteDefinition): number {
  const responses: readonly AnyRouteResponseDescriptor[] = Array.isArray(
    descriptor.response,
  )
    ? descriptor.response
    : [descriptor.response as AnyRouteResponseDescriptor];
  const success = responses.find(
    (response) => response.status >= 200 && response.status < 300,
  );
  return success?.status ?? 200;
}

export function routeResponseFormat(
  descriptor: RouteDefinition,
): "json" | "text" | "binary" {
  const responses: readonly AnyRouteResponseDescriptor[] = Array.isArray(
    descriptor.response,
  )
    ? descriptor.response
    : [descriptor.response as AnyRouteResponseDescriptor];
  return responses[0]?.format ?? "json";
}

export function routeParamNames(path: string): string[] {
  return path
    .split("/")
    .filter((segment) => segment.startsWith(":"))
    .map((segment) => segment.slice(1).replace(/\{.*\}$/, ""));
}

const zodV4MissingInputMessagePrefix = "Invalid input: expected ";
const zodV4MissingInputMessageSuffix = ", received undefined";

export function validationMessageFromZodError(error: ZodError): string {
  const issue = error.issues[0];
  if (!issue) {
    return "Invalid request";
  }
  if (
    issue.code === "invalid_type" &&
    issue.input === undefined &&
    issue.message.startsWith(zodV4MissingInputMessagePrefix) &&
    issue.message.endsWith(zodV4MissingInputMessageSuffix)
  ) {
    return "Required";
  }
  return issue.message;
}
