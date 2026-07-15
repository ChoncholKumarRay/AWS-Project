import { createServer } from "node:http";
import { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import { describe, expect, it } from "vitest";
import type { CloudProjectWithSecurityGroups } from "../db/dto.js";
import type { ProjectRepository } from "../projects/repository.js";
import type { PtyFactory, TerminalPty } from "./pty.js";
import { TerminalServer } from "./server.js";
import { SecurityPolicyService } from "../security/service.js";

describe("TerminalServer", () => {
  it("rejects non-running instances", async () => {
    const harness = await createHarness(
      projectRepository(project({ status: "STOPPED" })),
      new FakePtyFactory()
    );

    try {
      const ws = new WebSocket(`${harness.url}/api/ws/terminal/project-1`);
      const message = await nextMessage(ws);

      expect(message).toEqual({
        type: "error",
        message: "Instance must be RUNNING to connect"
      });
    } finally {
      await harness.close();
    }
  });

  it("rejects blocked clients during the WebSocket upgrade", async () => {
    const harness = await createHarness(
      projectRepository(
        project({
          securityGroups: [
            {
              projectId: "project-1",
              securityGroupId: "sg-1",
              attachedAt: new Date("2026-07-14T08:00:00.000Z"),
              securityGroup: {
                id: "sg-1",
                name: "ssh-other-ip",
                description: null,
                createdAt: new Date("2026-07-14T08:00:00.000Z"),
                updatedAt: new Date("2026-07-14T08:00:00.000Z"),
                rules: [
                  {
                    id: "rule-1",
                    groupId: "sg-1",
                    direction: "INBOUND",
                    protocol: "TCP",
                    fromPort: 22,
                    toPort: 22,
                    sourceIp: "203.0.113.7/32",
                    createdAt: new Date("2026-07-14T08:00:00.000Z"),
                    updatedAt: new Date("2026-07-14T08:00:00.000Z")
                  }
                ]
              }
            }
          ]
        })
      ),
      new FakePtyFactory()
    );

    try {
      const ws = new WebSocket(`${harness.url}/api/ws/terminal/project-1`);

      await expect(nextUnexpectedResponse(ws)).resolves.toBe(403);
    } finally {
      await harness.close();
    }
  });

  it("pipes input and resize messages to the PTY", async () => {
    const ptyFactory = new FakePtyFactory();
    const harness = await createHarness(
      projectRepository(project({ status: "RUNNING" })),
      ptyFactory
    );

    try {
      const ws = new WebSocket(`${harness.url}/api/ws/terminal/project-1`);
      const readyMessage = nextMessage(ws);
      await waitForOpen(ws);
      await expect(readyMessage).resolves.toEqual({ type: "ready" });

      ws.send(JSON.stringify({ type: "input", data: "ls\n" }));
      ws.send(JSON.stringify({ type: "resize", cols: 120, rows: 40 }));

      await eventually(() => {
        expect(ptyFactory.pty?.writes).toEqual(["ls\n"]);
        expect(ptyFactory.pty?.resizes).toEqual([{ cols: 120, rows: 40 }]);
      });
    } finally {
      await harness.close();
    }
  });

  it("cleans up the PTY when the socket closes", async () => {
    const ptyFactory = new FakePtyFactory();
    const harness = await createHarness(
      projectRepository(project({ status: "RUNNING" })),
      ptyFactory
    );

    try {
      const ws = new WebSocket(`${harness.url}/api/ws/terminal/project-1`);
      const readyMessage = nextMessage(ws);
      await waitForOpen(ws);
      await expect(readyMessage).resolves.toEqual({ type: "ready" });
      ws.close();

      await eventually(() => {
        expect(ptyFactory.pty?.wasKilled).toBe(true);
      });
    } finally {
      await harness.close();
    }
  });
});

async function createHarness(repository: ProjectRepository, ptyFactory: PtyFactory) {
  const httpServer = createServer();
  const terminalServer = new TerminalServer({
    repository,
    ptyFactory,
    securityPolicyService: new SecurityPolicyService()
  });

  httpServer.on("upgrade", (request, socket, head) => {
    void terminalServer.handleUpgrade(request, socket, head);
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(0, "127.0.0.1", resolve);
  });

  const address = httpServer.address() as AddressInfo;

  return {
    url: `ws://127.0.0.1:${address.port}`,
    async close() {
      await terminalServer.close();
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
      });
    }
  };
}

function project(overrides: Partial<CloudProjectWithSecurityGroups> = {}) {
  const now = new Date("2026-07-14T08:00:00.000Z");

  return {
    id: "project-1",
    name: "Terminal VM",
    description: null,
    status: "RUNNING",
    instanceName: "terminal-vm-a3f9",
    ipAddress: "10.176.164.20",
    instanceType: "t2.micro",
    vcpu: 1,
    memoryMb: 1024,
    publicKey: null,
    keyFingerprint: null,
    createdAt: now,
    updatedAt: now,
    securityGroups: [],
    ...overrides
  } satisfies CloudProjectWithSecurityGroups;
}

function projectRepository(projectValue: CloudProjectWithSecurityGroups): ProjectRepository {
  return {
    async list() {
      return [projectValue];
    },
    async create() {
      return projectValue;
    },
    async findById(id: string) {
      return id === projectValue.id ? projectValue : null;
    },
    async findByInstanceName(instanceName: string) {
      return projectValue.instanceName === instanceName ? projectValue : null;
    },
    async update() {
      return projectValue;
    },
    async delete() {
      return undefined;
    }
  };
}

function nextMessage(ws: WebSocket) {
  return new Promise<unknown>((resolve, reject) => {
    ws.once("message", (raw) => {
      resolve(JSON.parse(raw.toString("utf8")) as unknown);
    });
    ws.once("error", reject);
  });
}

function nextUnexpectedResponse(ws: WebSocket) {
  return new Promise<number>((resolve, reject) => {
    ws.once("unexpected-response", (_request, response) => {
      resolve(response.statusCode ?? 0);
    });
    ws.once("error", reject);
  });
}

function waitForOpen(ws: WebSocket) {
  if (ws.readyState === WebSocket.OPEN) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
}

async function eventually(assertion: () => void) {
  let lastError: unknown;

  for (let index = 0; index < 20; index += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  throw lastError;
}

class FakePtyFactory implements PtyFactory {
  pty: FakePty | undefined;

  spawnMultipassShell() {
    this.pty = new FakePty();
    return this.pty;
  }
}

class FakePty implements TerminalPty {
  writes: string[] = [];
  resizes: Array<{ cols: number; rows: number }> = [];
  wasKilled = false;

  onData() {
    return { dispose() {} };
  }

  onExit() {
    return { dispose() {} };
  }

  write(data: string) {
    this.writes.push(data);
  }

  resize(cols: number, rows: number) {
    this.resizes.push({ cols, rows });
  }

  kill() {
    this.wasKilled = true;
  }
}
