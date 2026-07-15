import { describe, expect, it, vi } from "vitest";
import { getInstanceTypeSpec } from "@local-cloud/shared";
import type { CloudProjectWithSecurityGroups } from "../db/dto.js";
import type { KeyPairService } from "../keys/keyPair.js";
import {
  MultipassClient,
  MultipassCommandError,
  type MultipassInfo
} from "../multipass/client.js";
import type { CreateProjectInput, ProjectRepository } from "./repository.js";
import { formatStartupError, mapServiceError, ProjectService } from "./service.js";

describe("ProjectService", () => {
  it("launches a t2.medium VM with authoritative server-side specs", async () => {
    const repository = new InMemoryProjectRepository();
    const multipass = new FakeMultipassClient();
    const service = new ProjectService({
      repository,
      multipass,
      keyPairService: fakeKeyPairService(),
      sleep: async () => undefined
    });

    const response = await service.launchProject({
      name: "My Server",
      description: "A demo VM",
      instanceType: "t2.medium"
    });

    expect(multipass.launchCalls).toHaveLength(1);
    expect(multipass.launchCalls[0]).toMatchObject({
      vcpu: 2,
      memoryMb: 4096
    });
    expect(multipass.launchCalls[0]?.name).toMatch(/^my-server-[a-f0-9]{4}$/);
    expect(multipass.launchCalls[0]?.cloudInit).toContain("#cloud-config");
    expect(multipass.launchCalls[0]?.cloudInit).toContain(
      "ssh-rsa AAAAFAKEPUBLICKEY"
    );
    expect(multipass.launchCalls[0]?.cloudInit).not.toContain(
      "BEGIN RSA PRIVATE KEY"
    );
    expect(response.privateKeyPem).toBe(
      "-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----\n"
    );
    expect(response.privateKeyFileName).toBe("my-server-key.pem");
    expect(response.project).toMatchObject({
      name: "My Server",
      description: "A demo VM",
      status: "RUNNING",
      ipAddress: "10.176.164.20",
      instanceType: "t2.medium",
      vcpu: 2,
      memoryMb: 4096,
      hasKey: true,
      keyFingerprint: "SHA256:fake"
    });
  });

  it("persists only public key material for launched instances", async () => {
    const repository = new InMemoryProjectRepository();
    const multipass = new FakeMultipassClient();
    const service = new ProjectService({
      repository,
      multipass,
      keyPairService: fakeKeyPairService()
    });

    const response = await service.launchProject({
      name: "Keyed VM"
    });
    const saved = await repository.findById(response.project.id);

    expect(saved?.publicKey).toBe("ssh-rsa AAAAFAKEPUBLICKEY");
    expect(saved?.keyFingerprint).toBe("SHA256:fake");
    expect(JSON.stringify(saved)).not.toContain("BEGIN RSA PRIVATE KEY");
  });

  it("rejects spoofed or unknown instance types", async () => {
    const service = new ProjectService({
      repository: new InMemoryProjectRepository(),
      multipass: new FakeMultipassClient()
    });

    await expect(
      service.launchProject({
        name: "Bad VM",
        instanceType: "m7i.48xlarge" as "t2.micro"
      })
    ).rejects.toThrow("Unknown instance type");
  });

  it("polls for an IPv4 address when Multipass is slow to report one", async () => {
    const repository = new InMemoryProjectRepository();
    const multipass = new FakeMultipassClient([
      multipassInfo({ ipv4: [] }),
      multipassInfo({ ipv4: ["10.176.164.21"] })
    ]);
    const sleep = vi.fn<(_delayMs: number) => Promise<void>>().mockResolvedValue();
    const service = new ProjectService({
      repository,
      multipass,
      sleep
    });

    const response = await service.launchProject({
      name: "Slow IP",
      instanceType: "t2.micro"
    });

    expect(response.project.ipAddress).toBe("10.176.164.21");
    expect(sleep).toHaveBeenCalledWith(2000);
    expect(multipass.infoCalls).toHaveLength(2);
  });

  it("starts an instance and refreshes its IPv4", async () => {
    const repository = new InMemoryProjectRepository();
    const existing = repository.seed({
      name: "Stopped",
      instanceName: "stopped-a3f9",
      status: "STOPPED",
      ipAddress: null,
      instanceType: "t2.small"
    });
    const multipass = new FakeMultipassClient([
      multipassInfo({
        name: "stopped-a3f9",
        ipv4: ["10.176.164.44"]
      })
    ]);
    const service = new ProjectService({ repository, multipass });

    const project = await service.startProject(existing.id);

    expect(multipass.startCalls).toEqual(["stopped-a3f9"]);
    expect(project.status).toBe("RUNNING");
    expect(project.ipAddress).toBe("10.176.164.44");
  });

  it("stops an instance while preserving its database row", async () => {
    const repository = new InMemoryProjectRepository();
    const existing = repository.seed({
      name: "Running",
      instanceName: "running-a3f9",
      status: "RUNNING",
      ipAddress: "10.176.164.11",
      instanceType: "t2.micro"
    });
    const multipass = new FakeMultipassClient();
    const service = new ProjectService({ repository, multipass });

    const project = await service.stopProject(existing.id);

    expect(multipass.stopCalls).toEqual(["running-a3f9"]);
    expect(project.status).toBe("STOPPED");
    expect(project.ipAddress).toBe("10.176.164.11");
  });

  it("self-heals terminate when the VM is already gone", async () => {
    const repository = new InMemoryProjectRepository();
    const existing = repository.seed({
      name: "Gone",
      instanceName: "gone-a3f9",
      status: "STOPPED",
      ipAddress: null,
      instanceType: "t2.micro"
    });
    const multipass = new FakeMultipassClient();
    multipass.deleteError = new MultipassCommandError(
      "missing",
      ["delete", "--purge", "gone-a3f9"],
      2,
      "instance not found"
    );
    const service = new ProjectService({ repository, multipass });

    await service.terminateProject(existing.id);

    await expect(repository.findById(existing.id)).resolves.toBeNull();
  });

  it("adopts existing Multipass VMs into the control-plane list", async () => {
    const repository = new InMemoryProjectRepository();
    const multipass = new FakeMultipassClient();
    multipass.listInfoResults = [
      multipassInfo({
        name: "web-server2-826d",
        cpuCount: 2,
        memory: {
          usedBytes: 512,
          totalBytes: 4094832640
        },
        ipv4: ["10.175.211.184"]
      })
    ];
    const service = new ProjectService({ repository, multipass });

    const projects = await service.listProjects();

    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({
      name: "web server2",
      instanceName: "web-server2-826d",
      status: "RUNNING",
      ipAddress: "10.175.211.184",
      instanceType: "t2.medium",
      hasKey: false
    });
  });

  it("maps Multipass command timeouts to clear gateway timeout errors", () => {
    const error = mapServiceError(
      new MultipassCommandError(
        "multipass start timed out",
        ["start", "slow-a3f9"],
        null,
        ""
      )
    );

    expect(error.statusCode).toBe(504);
    expect(error.message).toContain("timed out");
    expect(error.details).toMatchObject({
      command: ["multipass", "start", "slow-a3f9"],
      exitCode: null
    });
  });

  it("maps missing Multipass and DATABASE_URL to actionable messages", () => {
    const missingMultipass = new Error(
      "spawn multipass ENOENT"
    ) as NodeJS.ErrnoException;
    missingMultipass.code = "ENOENT";

    expect(mapServiceError(missingMultipass)).toMatchObject({
      statusCode: 503,
      message: expect.stringContaining("Multipass CLI was not found")
    });
    expect(
      formatStartupError(
        new Error("DATABASE_URL is required to create the Prisma client.")
      )
    ).toContain("DATABASE_URL is missing");
  });

  it("maps transient Neon connection failures without exposing secrets", () => {
    const neonError = Object.assign(new Error("connection terminated"), {
      code: "P1001"
    });
    const mapped = mapServiceError(neonError);

    expect(mapped.statusCode).toBe(503);
    expect(mapped.message).toContain("Database connection failed");
    expect(JSON.stringify(mapped)).not.toContain("postgresql://");
  });
});

class FakeMultipassClient extends MultipassClient {
  launchCalls: Array<{
    name: string;
    vcpu: number;
    memoryMb: number;
    cloudInit: string;
    timeoutMs?: number;
  }> = [];
  startCalls: string[] = [];
  stopCalls: string[] = [];
  deleteCalls: string[] = [];
  infoCalls: string[] = [];
  listInfoResults: MultipassInfo[] = [];
  deleteError: Error | undefined;

  constructor(private readonly infoResults: MultipassInfo[] = []) {
    super();
  }

  override async launch(options: {
    name: string;
    vcpu: number;
    memoryMb: number;
    cloudInit: string;
    timeoutMs?: number;
  }) {
    this.launchCalls.push(options);
  }

  override async start(name: string) {
    this.startCalls.push(name);
  }

  override async stop(name: string) {
    this.stopCalls.push(name);
  }

  override async deletePurge(name: string) {
    this.deleteCalls.push(name);
    if (this.deleteError) {
      throw this.deleteError;
    }
  }

  override async info(name: string) {
    this.infoCalls.push(name);
    return (
      this.infoResults.shift() ?? {
        name,
        state: "Running",
        ipv4: ["10.176.164.20"],
        cpuCount: null,
        loadAverage: [],
        memory: null,
        disks: []
      }
    );
  }

  override async listInfo() {
    return this.listInfoResults;
  }
}

function fakeKeyPairService(): KeyPairService {
  return {
    generateInstanceKeyPair() {
      return {
        privateKeyPem:
          "-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----\n",
        publicKeyOpenSsh: "ssh-rsa AAAAFAKEPUBLICKEY",
        fingerprint: "SHA256:fake"
      };
    }
  };
}

function multipassInfo(overrides: Partial<MultipassInfo> = {}): MultipassInfo {
  return {
    name: "ignored",
    state: "Running",
    ipv4: ["10.176.164.20"],
    cpuCount: null,
    loadAverage: [],
    memory: null,
    disks: [],
    ...overrides
  };
}

class InMemoryProjectRepository implements ProjectRepository {
  private projects = new Map<string, CloudProjectWithSecurityGroups>();
  private nextId = 1;

  async list() {
    return [...this.projects.values()];
  }

  async create(input: CreateProjectInput) {
    return this.seed(input);
  }

  async findById(id: string) {
    return this.projects.get(id) ?? null;
  }

  async findByInstanceName(instanceName: string) {
    return (
      [...this.projects.values()].find(
        (project) => project.instanceName === instanceName
      ) ?? null
    );
  }

  async update(
    id: string,
    input: Partial<Pick<CreateProjectInput, "status" | "ipAddress">>
  ) {
    const project = this.projects.get(id);

    if (!project) {
      throw new Error("not found");
    }

    const updated = {
      ...project,
      ...input,
      updatedAt: new Date("2026-07-14T09:00:00.000Z")
    };
    this.projects.set(id, updated);
    return updated;
  }

  async delete(id: string) {
    this.projects.delete(id);
  }

  seed(input: Partial<CreateProjectInput> & { name: string; instanceName: string }) {
    const id = `project-${this.nextId}`;
    this.nextId += 1;
    const spec = getInstanceTypeSpec(input.instanceType ?? "t2.micro");
    const now = new Date("2026-07-14T08:00:00.000Z");
    const project: CloudProjectWithSecurityGroups = {
      id,
      name: input.name,
      description: input.description ?? null,
      status: input.status ?? "RUNNING",
      instanceName: input.instanceName,
      ipAddress: input.ipAddress ?? null,
      instanceType: input.instanceType ?? spec.label,
      vcpu: input.vcpu ?? spec.vcpu,
      memoryMb: input.memoryMb ?? spec.memoryMb,
      publicKey: input.publicKey ?? null,
      keyFingerprint: input.keyFingerprint ?? null,
      createdAt: now,
      updatedAt: now,
      securityGroups: []
    };
    this.projects.set(id, project);
    return project;
  }
}
