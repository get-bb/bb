import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ZodType } from "zod";
import type * as z from "zod";
import type { EmptyInput, Endpoint } from "./endpoint.js";

export type RouteMethod = "get" | "post" | "patch" | "delete" | "put";
export type RouteResponseFormat = "json" | "text" | "binary";

export interface RouteResponseDescriptor<
  Output,
  Status extends ContentfulStatusCode,
  Format extends RouteResponseFormat,
> {
  status: Status;
  format: Format;
  readonly output?: Output;
}

export interface NoRouteRequest<Input> {
  source: "none";
  readonly input?: Input;
  readonly parsedInput?: never;
}

export interface QueryRouteRequest<Input, ParsedInput> {
  source: "query";
  schema: ZodType;
  readonly input?: Input;
  readonly parsedInput?: ParsedInput;
}

export interface JsonRouteRequest<
  Input,
  ParsedInput,
  Field extends string | null = string | null,
> {
  source: "json";
  schema: ZodType;
  field: Field;
  readonly input?: Input;
  readonly parsedInput?: ParsedInput;
}

export interface FormRouteRequest<Input> {
  source: "form";
  readonly input?: Input;
  readonly parsedInput?: never;
}

export type RouteRequestDescriptor<Input, ParsedInput> =
  | NoRouteRequest<Input>
  | QueryRouteRequest<Input, ParsedInput>
  | JsonRouteRequest<Input, ParsedInput>
  | FormRouteRequest<Input>;

export type AnyRouteRequestDescriptor = RouteRequestDescriptor<any, any>;

export type AnyRouteResponseDescriptor = RouteResponseDescriptor<
  any,
  ContentfulStatusCode,
  RouteResponseFormat
>;

export type RouteResponseDefinition =
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
  headers?: Readonly<Record<string, string>>;
}

type ParamName<Segment extends string> =
  Segment extends `${infer Name}{${string}` ? Name : Segment;

export type RouteParamNames<Path extends string> =
  Path extends `${string}:${infer Rest}`
    ? Rest extends `${infer Segment}/${infer Tail}`
      ? ParamName<Segment> | RouteParamNames<`/${Tail}`>
      : ParamName<Rest>
    : never;

export type RouteParams<Path extends string> = {
  [Name in RouteParamNames<Path>]: string;
};

export type RoutePathInput<Path extends string> = [
  RouteParamNames<Path>,
] extends [never]
  ? EmptyInput
  : { param: RouteParams<Path> };

export type RouteRequestInput<Request> = Request extends {
  readonly input?: infer Input;
}
  ? Input
  : never;

export type RouteParsedInput<Request> = Request extends {
  readonly parsedInput?: infer ParsedInput;
}
  ? ParsedInput
  : never;

export type EndpointFromRouteResponse<Input, Response> =
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
  Descriptor extends RouteDefinition<
    infer Path,
    any,
    infer Request,
    infer Response
  >
    ? EndpointFromRouteResponse<
        RoutePathInput<Path> & RouteRequestInput<Request>,
        Response
      >
    : never;

export type MethodKeyFromRouteMethod<Method extends RouteMethod> =
  Method extends "delete" ? "$delete" : `$${Method}`;

export type RouteDescriptorsIn<Value> = Value extends RouteDefinition
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

export type ApiSchemaFromRouteUnion<Routes extends RouteDefinition> = {
  [Path in RoutePath<Routes>]: {
    [
      Descriptor in Routes as Descriptor extends RouteDefinition<
        Path,
        infer Method,
        any,
        any
      >
        ? MethodKeyFromRouteMethod<Method>
        : never
    ]: EndpointFromRouteDescriptor<Descriptor>;
  };
};

export type ApiSchemaFromRouteDescriptors<Descriptors> =
  ApiSchemaFromRouteUnion<RouteDescriptorUnion<Descriptors>>;

export interface RouteResponseOptions<Status extends ContentfulStatusCode> {
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

export function noRequest(): NoRouteRequest<EmptyInput> {
  return { source: "none" };
}

export function queryRequest<const Schema extends ZodType>(
  schema: Schema,
): QueryRouteRequest<{ query: z.input<Schema> }, z.output<Schema>> {
  return { source: "query", schema };
}

export function optionalQueryRequest<const Schema extends ZodType>(
  schema: Schema,
): QueryRouteRequest<{ query?: z.input<Schema> }, z.output<Schema>> {
  return { source: "query", schema };
}

export function jsonRequest<const Schema extends ZodType>(
  schema: Schema,
): JsonRouteRequest<{ json: z.input<Schema> }, z.output<Schema>, null> {
  return { source: "json", schema, field: null };
}

export function jsonFieldRequest<
  const Field extends string,
  const Schema extends ZodType,
>(
  field: Field,
  schema: Schema,
): JsonRouteRequest<{ json: z.input<Schema> }, z.output<Schema>, Field> {
  return { source: "json", schema, field };
}

export function formRequest<FormInput>(): FormRouteRequest<{
  form: FormInput;
}> {
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
