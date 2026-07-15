import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { createApp } from "./app.js";
import { getPrismaClient } from "./db/client.js";
import { MetricsService } from "./metrics/service.js";
import { MultipassClient } from "./multipass/client.js";
import { NodePtyFactory } from "./terminal/pty.js";
import { TerminalServer } from "./terminal/server.js";
import { PrismaProjectRepository } from "./projects/repository.js";
import { formatStartupError } from "./projects/service.js";
import { SecurityPolicyService } from "./security/service.js";

config({
  path: fileURLToPath(new URL("../../../.env", import.meta.url))
});

const host = process.env.API_HOST ?? "0.0.0.0";
const port = Number.parseInt(process.env.API_PORT ?? "5000", 10);

if (Number.isNaN(port)) {
  throw new Error("API_PORT must be a valid integer.");
}

try {
  const prisma = getPrismaClient();
  const repository = new PrismaProjectRepository(prisma);
  const app = createApp({
    projectRepository: repository,
    metricsService: new MetricsService(repository, new MultipassClient())
  });
  const server = createServer(app);
  const terminalServer = new TerminalServer({
    repository,
    ptyFactory: new NodePtyFactory(),
    securityPolicyService: new SecurityPolicyService()
  });

  server.on("upgrade", (request, socket, head) => {
    if (request.url?.startsWith("/api/ws/terminal/")) {
      void terminalServer.handleUpgrade(request, socket, head);
      return;
    }

    socket.destroy();
  });

  server.listen(port, host, () => {
    console.log(`Local Cloud API listening on http://${host}:${port}`);
  });
} catch (error) {
  console.error(formatStartupError(error));
  process.exitCode = 1;
}
