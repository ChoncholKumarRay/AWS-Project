import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import type { ProjectRepository } from "../projects/repository.js";
import { withDbRetry } from "../db/retry.js";
import { normalizeClientIp } from "../security/cidr.js";
import type { SecurityPolicyService } from "../security/service.js";
import type { PtyFactory, TerminalPty } from "./pty.js";
import {
  parseTerminalClientMessage,
  serializeTerminalServerMessage
} from "./protocol.js";

export type TerminalServerOptions = {
  repository: ProjectRepository;
  ptyFactory: PtyFactory;
  securityPolicyService: SecurityPolicyService;
};

export class TerminalServer {
  private readonly wss = new WebSocketServer({ noServer: true });

  constructor(private readonly options: TerminalServerOptions) {
    this.wss.on("connection", (socket, request) => {
      void this.handleConnection(socket, request);
    });
  }

  async handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer) {
    const projectId = extractProjectId(request.url);

    if (!projectId) {
      rejectUpgrade(socket, 404, "Terminal endpoint not found");
      return;
    }

    const sourceIp = normalizeClientIp(
      request.headers["x-forwarded-for"]?.toString() ?? request.socket.remoteAddress
    );

    if (!sourceIp) {
      rejectUpgrade(socket, 403, "Blocked by Security Group");
      return;
    }

    try {
      const project = await withDbRetry(() => this.options.repository.findById(projectId));

      if (!project) {
        rejectUpgrade(socket, 404, "Instance not found");
        return;
      }

      const result = await this.options.securityPolicyService.evaluateProject(project, {
        direction: "INBOUND",
        protocol: "TCP",
        port: 22,
        sourceIp
      });

      if (!result.allowed) {
        rejectUpgrade(socket, 403, "Blocked by Security Group");
        return;
      }
    } catch {
      rejectUpgrade(socket, 403, "Blocked by Security Group");
      return;
    }

    request.url = `/api/ws/terminal/${projectId}`;
    this.wss.handleUpgrade(request, socket, head, (webSocket) => {
      this.wss.emit("connection", webSocket, request);
    });
  }

  async close() {
    for (const client of this.wss.clients) {
      client.terminate();
    }

    await new Promise<void>((resolve, reject) => {
      this.wss.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  private async handleConnection(socket: WebSocket, request: IncomingMessage) {
    const projectId = extractProjectId(request.url);

    if (!projectId) {
      send(socket, { type: "error", message: "Terminal endpoint not found" });
      socket.close(1008, "Terminal endpoint not found");
      return;
    }

    const project = await withDbRetry(() => this.options.repository.findById(projectId));

    if (!project) {
      send(socket, { type: "error", message: "Instance not found" });
      socket.close(1008, "Instance not found");
      return;
    }

    if (project.status !== "RUNNING") {
      send(socket, {
        type: "error",
        message: "Instance must be RUNNING to connect"
      });
      socket.close(1008, "Instance must be RUNNING");
      return;
    }

    let pty: TerminalPty;

    try {
      pty = this.options.ptyFactory.spawnMultipassShell(project.instanceName);
    } catch {
      send(socket, { type: "error", message: "Unable to start terminal session" });
      socket.close(1011, "Unable to start terminal session");
      return;
    }

    const dataDisposable = pty.onData((data) => {
      send(socket, { type: "output", data });
    });
    const exitDisposable = pty.onExit(() => {
      send(socket, { type: "exit" });
      socket.close(1000, "PTY exited");
    });

    socket.on("message", (raw) => {
      const message = parseTerminalClientMessage(rawToString(raw));

      if (!message) {
        return;
      }

      if (message.type === "input") {
        pty.write(message.data);
        return;
      }

      pty.resize(message.cols, message.rows);
    });

    socket.on("close", () => {
      dataDisposable.dispose();
      exitDisposable.dispose();
      pty.kill();
    });

    send(socket, { type: "ready" });
  }
}

export function extractProjectId(url: string | undefined) {
  if (!url) {
    return null;
  }

  const pathname = new URL(url, "http://localhost").pathname;
  const match = /^\/api\/ws\/terminal\/([^/]+)$/.exec(pathname);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function send(socket: WebSocket, message: Parameters<typeof serializeTerminalServerMessage>[0]) {
  if (socket.readyState === socket.OPEN) {
    socket.send(serializeTerminalServerMessage(message));
  }
}

function rejectUpgrade(socket: Duplex, statusCode: number, message: string) {
  socket.write(
    `HTTP/1.1 ${statusCode} ${message}\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(
      message
    )}\r\n\r\n${message}`
  );
  socket.destroy();
}

function rawToString(raw: RawData) {
  if (typeof raw === "string") {
    return raw;
  }

  if (Array.isArray(raw)) {
    return Buffer.concat(raw).toString("utf8");
  }

  if (raw instanceof ArrayBuffer) {
    return Buffer.from(new Uint8Array(raw)).toString("utf8");
  }

  return raw.toString("utf8");
}
