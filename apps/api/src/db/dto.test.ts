import { describe, expect, it } from "vitest";
import { toCloudProjectDto } from "./dto.js";
import type { CloudProjectWithSecurityGroups } from "./dto.js";

describe("database DTO mapping", () => {
  it("maps a project with attached security groups without exposing secrets", () => {
    const now = new Date("2026-07-14T08:00:00.000Z");
    const project: CloudProjectWithSecurityGroups = {
      id: "project-1",
      name: "Web Server",
      description: "Demo VM",
      status: "RUNNING",
      instanceName: "web-server-a3f9",
      ipAddress: "10.176.164.10",
      instanceType: "t2.micro",
      vcpu: 1,
      memoryMb: 1024,
      publicKey: "ssh-rsa AAAA...",
      keyFingerprint: "SHA256:abc",
      createdAt: now,
      updatedAt: now,
      securityGroups: [
        {
          projectId: "project-1",
          securityGroupId: "sg-1",
          attachedAt: now,
          securityGroup: {
            id: "sg-1",
            name: "ssh-my-ip",
            description: "SSH from my IP",
            createdAt: now,
            updatedAt: now,
            rules: [
              {
                id: "rule-1",
                groupId: "sg-1",
                direction: "INBOUND",
                protocol: "TCP",
                fromPort: 22,
                toPort: 22,
                sourceIp: "203.0.113.10/32",
                createdAt: now,
                updatedAt: now
              }
            ]
          }
        }
      ]
    };

    expect(toCloudProjectDto(project)).toEqual({
      id: "project-1",
      name: "Web Server",
      description: "Demo VM",
      status: "RUNNING",
      instanceName: "web-server-a3f9",
      ipAddress: "10.176.164.10",
      instanceType: "t2.micro",
      vcpu: 1,
      memoryMb: 1024,
      hasKey: true,
      keyFingerprint: "SHA256:abc",
      createdAt: "2026-07-14T08:00:00.000Z",
      updatedAt: "2026-07-14T08:00:00.000Z",
      securityGroups: [
        {
          id: "sg-1",
          name: "ssh-my-ip",
          description: "SSH from my IP",
          createdAt: "2026-07-14T08:00:00.000Z",
          updatedAt: "2026-07-14T08:00:00.000Z",
          rules: [
            {
              id: "rule-1",
              groupId: "sg-1",
              direction: "INBOUND",
              protocol: "TCP",
              fromPort: 22,
              toPort: 22,
              sourceIp: "203.0.113.10/32",
              createdAt: "2026-07-14T08:00:00.000Z",
              updatedAt: "2026-07-14T08:00:00.000Z"
            }
          ]
        }
      ]
    });
  });

  it("rejects unknown instance type values from the database", () => {
    const now = new Date("2026-07-14T08:00:00.000Z");
    const project = {
      id: "project-1",
      name: "Bad Server",
      description: null,
      status: "STOPPED",
      instanceName: "bad-server",
      ipAddress: null,
      instanceType: "c7g.metal",
      vcpu: 128,
      memoryMb: 262144,
      publicKey: null,
      keyFingerprint: null,
      createdAt: now,
      updatedAt: now,
      securityGroups: []
    } as CloudProjectWithSecurityGroups;

    expect(() => toCloudProjectDto(project)).toThrow(
      "Database contains unknown instance type"
    );
  });
});
