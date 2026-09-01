import { toNextJsHandler } from "better-auth/next-js";

import { getAuth } from "../../../../server/identity/runtime";

async function handle(request: Request): Promise<Response> {
  return getAuth().handler(request);
}

export const { DELETE, GET, PATCH, POST, PUT } = toNextJsHandler(handle);
