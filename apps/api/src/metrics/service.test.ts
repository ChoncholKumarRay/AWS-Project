import { describe, expect, it } from "vitest";
import type { CloudProjectWithSecurityGroups } from "../db/dto.js";
import { MultipassClient, type MultipassInfo } from "../multipass/client.js";
import type { ProjectRepository } from "../projects/repository.js";
import { buildMetricsDto, MetricsService } from "./service.js";

describe("metrics service", () => {
  it("derives CPU, memory, and disk utilization from Multipass info", () => {
    const metrics = buildMetricsDto(
      "project-1",
      "web-a3f9",
      {
        name: "web-a3f9",
        state: "Running",
        ipv4: ["10.176.164.20"],
        cpuCount: 2,
        loadAverage: [1],
        memory: {
          usedBytes: 512,
          totalBytes: 1024
        },
        disks: [
          {
            name: "sda1",
            usedBytes: 1000,
            totalBytes: 4000
          }
        ]
      },
      {
        networkIn: 100,
        networkOut: 200,
        diskRead: 300,
        diskWrite: 400
      }
    );

    expect(metrics.cpu.utilizationPercent).toBe(50);
    expect(metrics.memory.utilizationPercent).toBe(50);
    expect(metrics.disk.utilizationPercent).toBe(25);
    expect(metrics.network.inBytesPerSecond).toBe(100);
    expect(metrics.diskIo.writeBytesPerSecond).toBe(400);
  });

  it("returns a clear error for stopped instances", async () => {
    const service = new MetricsService(
      repository(project({ status: "STOPPED" })),
      new FakeMultipassClient()
    );

    await expect(service.getProjectMetrics("project-1")).rejects.toThrow(
      "Metrics are available only for RUNNING instances"
    );
  });
});

class FakeMultipassClient extends MultipassClient {
  override async info(): Promise<MultipassInfo> {
    return {
      name: "web-a3f9",
      state: "Running",
      ipv4: ["10.176.164.20"],
      cpuCount: 1,
      loadAverage: [0.25],
      memory: {
        usedBytes: 100,
        totalBytes: 200
      },
      disks: []
    };
  }
}

function repository(projectValue: CloudProjectWithSecurityGroups): ProjectRepository {
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

function project(overrides: Partial<CloudProjectWithSecurityGroups> = {}) {
  const now = new Date("2026-07-14T08:00:00.000Z");

  return {
    id: "project-1",
    name: "Web",
    description: null,
    status: "RUNNING",
    instanceName: "web-a3f9",
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
