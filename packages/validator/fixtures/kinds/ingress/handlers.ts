declare const dependencies: {
  resolveSubmission(request: Request): Promise<{ correlationId: string; workspaceId: string }>;
  service: { submit(input: unknown): Promise<{ kind: "created" | "duplicate" }> };
};
declare function parse(value: unknown): unknown;
declare function log(value: unknown): void;
declare function respond(status: number): Response;
declare function factory(): (request: Request) => Promise<Response>;

export async function POST(request: Request): Promise<Response> {
  const context = await dependencies.resolveSubmission(request);
  const document = parse(request);
  const result = await dependencies.service.submit({ context, document });
  return respond(result.kind === "created" ? 201 : 200);
}

export function GET(request: Request): Request {
  return request;
}

export function PUT(request: Request): Response {
  log(request.headers);
  return respond(200);
}

export function PATCH(request: Request): Response {
  for (const header of request.headers) {
    parse(header);
  }
  return respond(200);
}

export function DELETE(request: Request): Response {
  const method = request.method;
  return respond(method === "DELETE" ? 204 : 404);
}

export const HEAD = factory();

export function OPTIONS(request: Request): Response {
  const later = () => request.method;
  log(later);
  return respond(200);
}

export async function TRACE(request: Request): Promise<Response> {
  parse(request);
  await dependencies.service.submit(() => request.method);
  return respond(200);
}

export function CONNECT(request: Request): Response {
  let value: unknown = request.method;
  value = "fixed";
  log(value);
  return respond(200);
}

function ignored(request: Request): Request {
  return request;
}

void ignored;
