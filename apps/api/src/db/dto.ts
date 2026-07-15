import type {
  CloudProjectDto,
  InstanceTypeId,
  SecurityGroupDto,
  SecurityRuleDto
} from "@local-cloud/shared";
import { isInstanceTypeId } from "@local-cloud/shared";
import type {
  CloudProject,
  ProjectSecurityGroup,
  SecurityGroup,
  SecurityRule
} from "../generated/prisma/client.js";

type SecurityGroupWithRules = SecurityGroup & {
  rules: SecurityRule[];
};

type ProjectSecurityGroupWithGroup = ProjectSecurityGroup & {
  securityGroup: SecurityGroupWithRules;
};

export type CloudProjectWithSecurityGroups = CloudProject & {
  securityGroups: ProjectSecurityGroupWithGroup[];
};

export function toSecurityRuleDto(rule: SecurityRule): SecurityRuleDto {
  return {
    id: rule.id,
    groupId: rule.groupId,
    direction: rule.direction,
    protocol: rule.protocol,
    fromPort: rule.fromPort,
    toPort: rule.toPort,
    sourceIp: rule.sourceIp,
    createdAt: rule.createdAt.toISOString(),
    updatedAt: rule.updatedAt.toISOString()
  };
}

export function toSecurityGroupDto(group: SecurityGroupWithRules): SecurityGroupDto {
  return {
    id: group.id,
    name: group.name,
    description: group.description,
    createdAt: group.createdAt.toISOString(),
    updatedAt: group.updatedAt.toISOString(),
    rules: group.rules.map(toSecurityRuleDto)
  };
}

export function toCloudProjectDto(
  project: CloudProjectWithSecurityGroups
): CloudProjectDto {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    status: project.status,
    instanceName: project.instanceName,
    ipAddress: project.ipAddress,
    instanceType: toInstanceTypeId(project.instanceType),
    vcpu: project.vcpu,
    memoryMb: project.memoryMb,
    hasKey: Boolean(project.publicKey),
    keyFingerprint: project.keyFingerprint,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
    securityGroups: project.securityGroups.map((attachment) =>
      toSecurityGroupDto(attachment.securityGroup)
    )
  };
}

function toInstanceTypeId(instanceType: string): InstanceTypeId {
  if (!isInstanceTypeId(instanceType)) {
    throw new Error(`Database contains unknown instance type: ${instanceType}`);
  }

  return instanceType;
}
