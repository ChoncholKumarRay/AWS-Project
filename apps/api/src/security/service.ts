import type {
  SecurityGroupDto,
  SecurityProtocol,
  SecurityRuleDirection
} from "@local-cloud/shared";
import { toSecurityGroupDto, type CloudProjectWithSecurityGroups } from "../db/dto.js";
import { withDbRetry } from "../db/retry.js";
import { HttpError } from "../errors.js";
import type { AppPrismaClient } from "../db/client.js";
import { evaluateSecurityGroups, type PolicyGroup, type TrafficRequest } from "./evaluator.js";
import { parseCidr } from "./cidr.js";

export type CreateSecurityGroupInput = {
  name: string;
  description?: string;
};

export type UpdateSecurityGroupInput = CreateSecurityGroupInput;

export type CreateSecurityRuleInput = {
  direction?: SecurityRuleDirection;
  protocol: SecurityProtocol;
  fromPort?: number | null;
  toPort?: number | null;
  sourceIp: string;
};

export class SecurityGroupService {
  constructor(private readonly prisma: AppPrismaClient) {}

  async listGroups(): Promise<SecurityGroupDto[]> {
    const groups = await withDbRetry(() =>
      this.prisma.securityGroup.findMany({
        include: { rules: true },
        orderBy: { createdAt: "desc" }
      })
    );

    return groups.map(toSecurityGroupDto);
  }

  async createGroup(input: CreateSecurityGroupInput): Promise<SecurityGroupDto> {
    const name = input.name.trim();

    if (!name) {
      throw new HttpError(400, "Security group name is required");
    }

    const group = await withDbRetry(() =>
      this.prisma.securityGroup.create({
        data: {
          name,
          description: input.description?.trim() || null
        },
        include: { rules: true }
      })
    );

    return toSecurityGroupDto(group);
  }

  async deleteGroup(id: string): Promise<void> {
    await withDbRetry(() =>
      this.prisma.securityGroup.delete({
        where: { id }
      })
    );
  }

  async updateGroup(
    id: string,
    input: UpdateSecurityGroupInput
  ): Promise<SecurityGroupDto> {
    const name = input.name.trim();

    if (!name) {
      throw new HttpError(400, "Security group name is required");
    }

    const group = await withDbRetry(() =>
      this.prisma.securityGroup.update({
        where: { id },
        data: {
          name,
          description: input.description?.trim() || null
        },
        include: { rules: true }
      })
    );

    return toSecurityGroupDto(group);
  }

  async addRule(groupId: string, input: CreateSecurityRuleInput): Promise<SecurityGroupDto> {
    validateRuleInput(input);

    await withDbRetry(() =>
      this.prisma.securityRule.create({
        data: {
          groupId,
          direction: input.direction ?? "INBOUND",
          protocol: input.protocol,
          fromPort: input.fromPort ?? null,
          toPort: input.toPort ?? input.fromPort ?? null,
          sourceIp: input.sourceIp
        }
      })
    );

    return this.getGroup(groupId);
  }

  async deleteRule(groupId: string, ruleId: string): Promise<SecurityGroupDto> {
    await withDbRetry(() =>
      this.prisma.securityRule.delete({
        where: { id: ruleId }
      })
    );

    return this.getGroup(groupId);
  }

  async getAttachedGroups(projectId: string): Promise<SecurityGroupDto[]> {
    const project = await this.prisma.cloudProject.findUnique({
      where: { id: projectId },
      include: {
        securityGroups: {
          include: {
            securityGroup: {
              include: { rules: true }
            }
          }
        }
      }
    });

    if (!project) {
      throw new HttpError(404, "Project not found");
    }

    return project.securityGroups.map((attachment) =>
      toSecurityGroupDto(attachment.securityGroup)
    );
  }

  async replaceAttachedGroups(
    projectId: string,
    securityGroupIds: string[]
  ): Promise<SecurityGroupDto[]> {
    await withDbRetry(() =>
      this.prisma.$transaction(async (tx) => {
        await tx.projectSecurityGroup.deleteMany({
          where: { projectId }
        });

        if (securityGroupIds.length > 0) {
          await tx.projectSecurityGroup.createMany({
            data: securityGroupIds.map((securityGroupId) => ({
              projectId,
              securityGroupId
            })),
            skipDuplicates: true
          });
        }
      })
    );

    return this.getAttachedGroups(projectId);
  }

  async getGroup(id: string): Promise<SecurityGroupDto> {
    const group = await withDbRetry(() =>
      this.prisma.securityGroup.findUnique({
        where: { id },
        include: { rules: true }
      })
    );

    if (!group) {
      throw new HttpError(404, "Security group not found");
    }

    return toSecurityGroupDto(group);
  }
}

export class SecurityPolicyService {
  async evaluateProject(
    project: CloudProjectWithSecurityGroups,
    traffic: TrafficRequest
  ) {
    const groups: PolicyGroup[] = project.securityGroups.map((attachment) => ({
      id: attachment.securityGroup.id,
      name: attachment.securityGroup.name,
      rules: attachment.securityGroup.rules.map((rule) => ({
        direction: rule.direction,
        protocol: rule.protocol,
        fromPort: rule.fromPort,
        toPort: rule.toPort,
        sourceIp: rule.sourceIp
      }))
    }));

    return evaluateSecurityGroups(groups, traffic);
  }
}

function validateRuleInput(input: CreateSecurityRuleInput) {
  parseCidr(input.sourceIp);

  if (input.protocol !== "ICMP" && input.protocol !== "ALL") {
    const fromPort = input.fromPort ?? input.toPort;
    const toPort = input.toPort ?? input.fromPort;

    if (
      fromPort === undefined ||
      fromPort === null ||
      toPort === undefined ||
      toPort === null ||
      fromPort < 1 ||
      toPort > 65535 ||
      fromPort > toPort
    ) {
      throw new HttpError(400, "A valid port or port range is required");
    }
  }
}
