export const APP_NAME = "Local Cloud Console";

export type ServiceHealth = {
  status: "ok";
  service: string;
};

export const INSTANCE_STATUSES = ["RUNNING", "STOPPED"] as const;
export type InstanceStatus = (typeof INSTANCE_STATUSES)[number];

export const INSTANCE_TYPES = {
  "t2.micro": {
    label: "t2.micro",
    vcpu: 1,
    memoryMb: 1024,
    memoryLabel: "1 GB"
  },
  "t2.small": {
    label: "t2.small",
    vcpu: 1,
    memoryMb: 2048,
    memoryLabel: "2 GB"
  },
  "t2.medium": {
    label: "t2.medium",
    vcpu: 2,
    memoryMb: 4096,
    memoryLabel: "4 GB"
  }
} as const;

export type InstanceTypeId = keyof typeof INSTANCE_TYPES;

export type InstanceTypeSpec = {
  label: InstanceTypeId;
  vcpu: number;
  memoryMb: number;
  memoryLabel: string;
};

export const DEFAULT_INSTANCE_TYPE: InstanceTypeId = "t2.micro";

export function isInstanceTypeId(value: string): value is InstanceTypeId {
  return Object.hasOwn(INSTANCE_TYPES, value);
}

export function getInstanceTypeSpec(instanceType: string): InstanceTypeSpec {
  if (!isInstanceTypeId(instanceType)) {
    throw new Error(`Unknown instance type: ${instanceType}`);
  }

  return INSTANCE_TYPES[instanceType];
}

export const SECURITY_PROTOCOLS = ["TCP", "UDP", "ICMP", "ALL"] as const;
export type SecurityProtocol = (typeof SECURITY_PROTOCOLS)[number];

export const SECURITY_RULE_DIRECTIONS = ["INBOUND", "OUTBOUND"] as const;
export type SecurityRuleDirection = (typeof SECURITY_RULE_DIRECTIONS)[number];

export type SecurityRuleDto = {
  id: string;
  groupId: string;
  direction: SecurityRuleDirection;
  protocol: SecurityProtocol;
  fromPort: number | null;
  toPort: number | null;
  sourceIp: string;
  createdAt: string;
  updatedAt: string;
};

export type SecurityGroupDto = {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  rules: SecurityRuleDto[];
};

export type CloudProjectDto = {
  id: string;
  name: string;
  description: string | null;
  status: InstanceStatus;
  instanceName: string;
  ipAddress: string | null;
  instanceType: InstanceTypeId;
  vcpu: number;
  memoryMb: number;
  hasKey: boolean;
  keyFingerprint: string | null;
  createdAt: string;
  updatedAt: string;
  securityGroups: SecurityGroupDto[];
};

export type LaunchProjectRequest = {
  name: string;
  description?: string;
  instanceType?: InstanceTypeId;
};

export type LaunchProjectResponse = {
  project: CloudProjectDto;
  privateKeyPem: string;
  privateKeyFileName: string;
};

export type InstanceTypeCatalogResponse = {
  defaultType: InstanceTypeId;
  types: InstanceTypeSpec[];
};

export type ListProjectsResponse = {
  projects: CloudProjectDto[];
};

export type ProjectActionResponse = {
  project: CloudProjectDto;
};

export type TerminateProjectResponse = {
  id: string;
  terminated: true;
};

export type ProjectMetricsDto = {
  projectId: string;
  instanceName: string;
  timestamp: string;
  cpu: {
    utilizationPercent: number;
    loadAverage1m: number;
    vcpu: number;
  };
  memory: {
    usedBytes: number;
    totalBytes: number;
    utilizationPercent: number;
  };
  disk: {
    usedBytes: number;
    totalBytes: number;
    utilizationPercent: number;
  };
  network: {
    inBytesPerSecond: number;
    outBytesPerSecond: number;
  };
  diskIo: {
    readBytesPerSecond: number;
    writeBytesPerSecond: number;
  };
};

export type CreateSecurityGroupRequest = {
  name: string;
  description?: string;
};

export type UpdateSecurityGroupRequest = {
  name: string;
  description?: string;
};

export type CreateSecurityRuleRequest = {
  direction?: SecurityRuleDirection;
  protocol: SecurityProtocol;
  fromPort?: number | null;
  toPort?: number | null;
  sourceIp: string;
};

export type ReplaceProjectSecurityGroupsRequest = {
  securityGroupIds: string[];
};

export type SecurityGroupListResponse = {
  securityGroups: SecurityGroupDto[];
};
