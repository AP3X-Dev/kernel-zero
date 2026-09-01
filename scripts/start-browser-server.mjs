import path from "node:path";

import { startServer } from "next/dist/server/lib/start-server.js";

await startServer({
  allowRetry: false,
  dir: path.resolve("apps", "control"),
  hostname: "localhost",
  isDev: false,
  port: 3100,
});
