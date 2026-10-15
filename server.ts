import { createServer, type Server as HttpServer } from "node:http";
import { loadEnvConfig } from "@next/env";
import type { Server as SocketServer } from "socket.io";

// Windows has no POSIX env assignment in npm scripts. `npm start` passes
// `--production`; Render can also set NODE_ENV itself.
if (process.argv.includes("--production")) {
  Object.assign(process.env, { NODE_ENV: "production" });
} else if (!process.env.NODE_ENV) {
  Object.assign(process.env, { NODE_ENV: "development" });
}

loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");

process.on("unhandledRejection", (reason) => {
  console.error("unhandledRejection", reason);
});

const port = Number.parseInt(process.env.PORT || "3000", 10);
const hostname = "0.0.0.0";
const dev = process.env.NODE_ENV !== "production";

async function closeHttpServer(server: HttpServer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function closeSocketServer(io: SocketServer): Promise<void> {
  await new Promise<void>((resolve) => {
    io.close(() => {
      resolve();
    });
  });
}

async function main(): Promise<void> {
  const { default: next } = await import("next");
  const { attachSocketServer } = await import("./lib/realtime/socket-server");
  const { pool } = await import("./lib/db");

  pool.on("error", (error) => {
    console.error("postgres pool error", error);
  });

  const { cleanupExpiredSessions } = await import("./lib/auth/session");
  await cleanupExpiredSessions();
  const cleanupTimer = setInterval(() => {
    void cleanupExpiredSessions();
  }, 60 * 60 * 1000);
  cleanupTimer.unref();

  const app = next({ dev, hostname, port });
  const handle = app.getRequestHandler();

  await app.prepare();

  const handleUpgrade = app.getUpgradeHandler();

  const server = createServer((req, res) => {
    void handle(req, res).catch((error: unknown) => {
      console.error(error);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end("Internal Server Error");
      }
    });
  });

  const io = attachSocketServer(server);

  server.on("upgrade", (req, socket, head) => {
    const url = req.url ?? "";
    if (url.startsWith("/socket.io")) {
      return;
    }
    void handleUpgrade(req, socket, head);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, hostname, () => {
      server.off("error", reject);
      resolve();
    });
  });

  console.log(
    `> Server listening at http://${hostname}:${port} as ${
      dev ? "development" : "production"
    }`,
  );

  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    clearInterval(cleanupTimer);
    console.log(`Received ${signal}, shutting down`);

    try {
      await closeSocketServer(io);
      await closeHttpServer(server);
      await pool.end();
      process.exit(0);
    } catch (error) {
      console.error(error);
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
