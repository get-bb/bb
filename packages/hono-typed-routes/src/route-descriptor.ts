import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ZodType } from "zod";
import type * as z from "zod";
import type { EmptyInput, Endpoint } from "./endpoint.js";

export type RouteMethod = "get" | "post" | "patch" | "delete" | "put";
type RouteResponseFormat = "json" | "text" | "binary";

interface RouteResponseDescriptor<
  Output,
  Status extends ContentfulStatusCode,
  Format extends RouteResponseFormat,
> {
  status: Status;
  format: Format;
  readonly output?: Output;
}

interface NoRouteRequest<Input> {
  source: "none";
  readonly input?: Input;
  readonly parsedInput?: never;
}

interface QueryRouteRequest<Input, ParsedInput> {
  source: "query";
  schema: ZodType;
  readonly input?: Input;
  readonly parsedInput?: ParsedInput;
}

interface JsonRouteRequest<Input, ParsedInput> {
  source: "json";
  schema: ZodType;
  readonly input?: Input;
  readonly parsedInput?: ParsedInput;
}

interface FormRouteRequest<Input> {
  source: "form";
  readonly input?: Input;
  readonly parsedInput?: never;
}

type RouteRequestDescriptor<Input, ParsedInput> =
  | NoRouteRequest<Input>
  | QueryRouteRequest<Input, ParsedInput>
  | JsonRouteRequest<Input, ParsedInput>
  | FormRouteRequest<Input>;

type AnyRouteRequestDescriptor = RouteRequestDescriptor<any, any>;

type AnyRouteResponseDescriptor = RouteResponseDescriptor<
  any,
  ContentfulStatusCode,
  RouteResponseFormat
>;

type RouteResponseDefinition =
  | AnyRouteResponseDescriptor
  | readonly AnyRouteResponseDescriptor[];

export interface RouteDefinition<
  Path extends string = string,
  Method extends RouteMethod = RouteMethod,
  Request extends AnyRouteRequestDescriptor = AnyRouteRequestDescriptor,
  Response extends RouteResponseDefinition = RouteResponseDefinition,
> {
  path: Path;
  method: Method;
  request: Request;
  response: Response;
}

type RouteRequestInput<Request> = Request extends {
  readonly input?: infer Input;
}
  ? Input
  : never;

export type RouteParsedInput<Request> = Request extends {
  readonly parsedInput?: infer ParsedInput;
}
  ? ParsedInput
  : never;

type EndpointFromRouteResponse<Input, Response> =
  Response extends readonly AnyRouteResponseDescriptor[]
    ? {
        [Index in keyof Response]: EndpointFromRouteResponse<
          Input,
          Response[Index]
        >;
      }[number]
    : Response extends RouteResponseDescriptor<
          infer Output,
          infer Status,
          infer Format
        >
      ? Endpoint<Input, Output, Status, Format>
      : never;

export type EndpointFromRouteDescriptor<Descriptor> =
  Descriptor extends RouteDefinition<any, any, infer Request, infer Response>
    ? EndpointFromRouteResponse<RouteRequestInput<Request>, Response>
    : never;

type MethodKeyFromRouteMethod<Method extends RouteMethod> =
  Method extends "delete" ? "$delete" : `$${Method}`;

type RouteDescriptorsIn<Value> = Value extends RouteDefinition
  ? Value
  : Value extends object
    ? { [Key in keyof Value]: RouteDescriptorsIn<Value[Key]> }[keyof Value]
    : never;

type RouteDescriptorUnion<Descriptors> = Extract<
  RouteDescriptorsIn<Descriptors>,
  RouteDefinition
>;

type RoutePath<Descriptor> =
  Descriptor extends RouteDefinition<infer Path, any, any, any> ? Path : never;

type ApiSchemaFromRouteUnion<Routes extends RouteDefinition> = {
  [Path in RoutePath<Routes>]: {
    [Descriptor in Routes as Descriptor extends RouteDefinition<
      Path,
      infer Method,
      any,
      any
    >
      ? MethodKeyFromRouteMethod<Method>
      : never]: EndpointFromRouteDescriptor<Descriptor>;
  };
};

export type ApiSchemaFromRouteDescriptors<Descriptors> =
  ApiSchemaFromRouteUnion<RouteDescriptorUnion<Descriptors>>;

interface RouteResponseOptions<Status extends ContentfulStatusCode> {
  status: Status;
}

export function jsonResponse<Output>(
  options: RouteResponseOptions<201>,
): RouteResponseDescriptor<Output, 201, "json">;
export function jsonResponse<Output>(
  options: RouteResponseOptions<404>,
): RouteResponseDescriptor<Output, 404, "json">;
export function jsonResponse<Output>(
  options: RouteResponseOptions<409>,
): RouteResponseDescriptor<Output, 409, "json">;
export function jsonResponse<Output>(
  options?: undefined,
): RouteResponseDescriptor<Output, 200, "json">;
export function jsonResponse<Output, const Status extends ContentfulStatusCode>(
  options: RouteResponseOptions<Status>,
): RouteResponseDescriptor<Output, Status, "json">;
export function jsonResponse<Output, const Status extends ContentfulStatusCode>(
  options?: RouteResponseOptions<Status>,
): RouteResponseDescriptor<Output, 200 | Status, "json"> {
  const status = options && "status" in options ? options.status : 200;
  return {
    status,
    format: "json",
  };
}

export function binaryResponse<Output>(): RouteResponseDescriptor<
  Output,
  200,
  "binary"
> {
  return { status: 200, format: "binary" };
}

export function textResponse<Output>(): RouteResponseDescriptor<
  Output,
  200,
  "text"
> {
  return { status: 200, format: "text" };
}

export function noRequest<Input = EmptyInput>(): NoRouteRequest<Input> {
  return { source: "none" };
}

export function queryRequest<
  InputPrefix,
  QueryInput,
  Schema extends ZodType = ZodType<QueryInput>,
>(
  schema: Schema,
): QueryRouteRequest<InputPrefix & { query: QueryInput }, z.output<Schema>> {
  return { source: "query", schema };
}

export function optionalQueryRequest<
  InputPrefix,
  QueryInput,
  Schema extends ZodType = ZodType<QueryInput>,
>(
  schema: Schema,
): QueryRouteRequest<
  InputPrefix & { query?: QueryInput },
  z.output<Schema>
> {
  return { source: "query", schema };
}

export function jsonRequest<
  InputPrefix,
  BodyInput,
  Schema extends ZodType = ZodType<BodyInput>,
>(
  schema: Schema,
): JsonRouteRequest<InputPrefix & { json: BodyInput }, z.output<Schema>> {
  return { source: "json", schema };
}

export function formRequest<InputPrefix, FormInput>(): FormRouteRequest<
  InputPrefix & { form: FormInput }
> {
  return { source: "form" };
}

export function defineRoute<
  const Path extends string,
  const Method extends RouteMethod,
  const Request extends AnyRouteRequestDescriptor,
  const Response extends RouteResponseDefinition,
>(
  definition: RouteDefinition<Path, Method, Request, Response>,
): RouteDefinition<Path, Method, Request, Response> {
  return definition;
}
