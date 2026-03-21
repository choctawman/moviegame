import "dotenv/config";

import { AsyncLocalStorage } from "node:async_hooks";
import { createServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";

import { registerDraftSocketNamespace } from "@/server/realtime/draftSocket";

if (typeof (globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage !== "function") {
  // Next.js expects AsyncLocalStorage on globalThis in this runtime path.
  (globalThis as { AsyncLocalStorage?: typeof AsyncLocalStorage }).AsyncLocalStorage = AsyncLocalStorage;
}

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOST ?? "0.0.0.0";
const port = Number(process.env.PORT ?? 3000);

async function bootstrap(): Promise<void> {
  const { default: next } = await import("next");
  const app = next({ dev, hostname, port });
  const handle = app.getRequestHandler();

  await app.prepare();

  const httpServer = createServer((req, res) => {
    void handle(req, res);
  });

  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: process.env.APP_URL ?? "*",
      credentials: true,
    },
  });

  registerDraftSocketNamespace(io);

  httpServer.listen(port, hostname, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
  });
}

bootstrap().catch((error) => {
  console.error("Failed to start server", error);
  process.exit(1);
});
