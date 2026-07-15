import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import type { KeyPairService } from "../keys/keyPair.js";
import { MetricsService } from "../metrics/service.js";
import { MultipassClient } from "../multipass/client.js";
import { SecurityGroupService } from "../security/service.js";
import { ProjectService } from "./service.js";
import type { CreateProjectInput, ProjectRepository } from "./repository.js";
import type { CloudProjectWithSecurityGroups } from "../db/dto.js";

describe("project routes", () => {
  it("returns the authoritative instance type catalog", async () => {
    const repository = emptyRepository();
    const app = createApp({
      projectService: new ProjectService({
        repository,
        multipass: new MultipassClient()
      }),
      projectRepository: repository,
      metricsService: fakeMetricsService(),
      securityGroupService: fakeSecurityGroupService()
    });

    const response = await request(app).get("/api/instance-types").expect(200);

    expect(response.body.defaultType).toBe("t2.micro");
    expect(response.body.types).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "t2.medium", vcpu: 2, memoryMb: 4096 })
      ])
    );
  });

  it("validates launch requests before reaching Multipass", async () => {
    const repository = emptyRepository();
    const app = createApp({
      projectService: new ProjectService({
        repository,
        multipass: new MultipassClient()
      }),
      projectRepository: repository,
      metricsService: fakeMetricsService(),
      securityGroupService: fakeSecurityGroupService()
    });

    const response = await request(app)
      .post("/api/projects")
      .send({ name: "Bad", instanceType: "made-up" })
      .expect(400);

    expect(response.body.error).toContain("Unknown instance type");
  });

  it("returns the private key only in the launch response", async () => {
    const repository = oneShotRepository();
    const app = createApp({
      projectService: new ProjectService({
        repository,
        multipass: new FastMultipassClient(),
        keyPairService: fakeKeyPairService()
      }),
      projectRepository: repository,
      metricsService: fakeMetricsService(),
      securityGroupService: fakeSecurityGroupService()
    });

    const response = await request(app)
      .post("/api/projects")
      .send({ name: "API Keyed VM", instanceType: "t2.micro" })
      .expect(200);

    expect(response.body.privateKeyPem).toContain("BEGIN RSA PRIVATE KEY");
    expect(response.body.privateKeyFileName).toBe("api-keyed-vm-key.pem");
    expect(response.body.project.hasKey).toBe(true);
    expect(response.body.project).not.toHaveProperty("publicKey");
  });
});

function emptyRepository(): ProjectRepository {
  return {
    async list() {
      return [];
    },
    async create() {
      throw new Error("not implemented");
    },
    async findById() {
      return null;
    },
    async findByInstanceName() {
      return null;
    },
    async update() {
      throw new Error("not implemented");
    },
    async delete() {
      throw new Error("not implemented");
    }
  };
}

function oneShotRepository(): ProjectRepository {
  let created: CloudProjectWithSecurityGroups | null = null;

  return {
    async list() {
      return created ? [created] : [];
    },
    async create(input: CreateProjectInput) {
      const now = new Date("2026-07-14T08:00:00.000Z");
      created = {
        id: "project-1",
        name: input.name,
        description: input.description,
        status: input.status,
        instanceName: input.instanceName,
        ipAddress: input.ipAddress,
        instanceType: input.instanceType,
        vcpu: input.vcpu,
        memoryMb: input.memoryMb,
        publicKey: input.publicKey ?? null,
        keyFingerprint: input.keyFingerprint ?? null,
        createdAt: now,
        updatedAt: now,
        securityGroups: []
      };
      return created;
    },
    async findById() {
      return created;
    },
    async findByInstanceName(instanceName: string) {
      return created?.instanceName === instanceName ? created : null;
    },
    async update() {
      throw new Error("not implemented");
    },
    async delete() {
      created = null;
    }
  };
}

class FastMultipassClient extends MultipassClient {
  override async launch() {
    return undefined;
  }

  override async info(name: string) {
    return {
      name,
      state: "Running",
      ipv4: ["10.176.164.33"],
      cpuCount: null,
      loadAverage: [],
      memory: null,
      disks: []
    };
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

function fakeMetricsService(): MetricsService {
  return new MetricsService(emptyRepository(), new MultipassClient());
}

function fakeSecurityGroupService(): SecurityGroupService {
  return {
    async listGroups() {
      return [];
    }
  } as unknown as SecurityGroupService;
}
