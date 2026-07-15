import type { Prisma } from "../generated/prisma/client.js";
import type { AppPrismaClient } from "../db/client.js";
import type { CloudProjectWithSecurityGroups } from "../db/dto.js";

const projectInclude = {
  securityGroups: {
    include: {
      securityGroup: {
        include: {
          rules: true
        }
      }
    }
  }
} satisfies Prisma.CloudProjectInclude;

export type CreateProjectInput = {
  name: string;
  description: string | null;
  status: "RUNNING" | "STOPPED";
  instanceName: string;
  ipAddress: string | null;
  instanceType: string;
  vcpu: number;
  memoryMb: number;
  publicKey?: string | null;
  keyFingerprint?: string | null;
};

export type ProjectRepository = {
  list(): Promise<CloudProjectWithSecurityGroups[]>;
  create(input: CreateProjectInput): Promise<CloudProjectWithSecurityGroups>;
  findById(id: string): Promise<CloudProjectWithSecurityGroups | null>;
  findByInstanceName(instanceName: string): Promise<CloudProjectWithSecurityGroups | null>;
  update(
    id: string,
    input: Partial<Pick<CreateProjectInput, "status" | "ipAddress">>
  ): Promise<CloudProjectWithSecurityGroups>;
  delete(id: string): Promise<void>;
};

export class PrismaProjectRepository implements ProjectRepository {
  constructor(private readonly prisma: AppPrismaClient) {}

  list() {
    return this.prisma.cloudProject.findMany({
      include: projectInclude,
      orderBy: {
        createdAt: "desc"
      }
    }) as Promise<CloudProjectWithSecurityGroups[]>;
  }

  create(input: CreateProjectInput) {
    return this.prisma.cloudProject.create({
      data: input,
      include: projectInclude
    }) as Promise<CloudProjectWithSecurityGroups>;
  }

  findById(id: string) {
    return this.prisma.cloudProject.findUnique({
      where: { id },
      include: projectInclude
    }) as Promise<CloudProjectWithSecurityGroups | null>;
  }

  findByInstanceName(instanceName: string) {
    return this.prisma.cloudProject.findUnique({
      where: { instanceName },
      include: projectInclude
    }) as Promise<CloudProjectWithSecurityGroups | null>;
  }

  update(
    id: string,
    input: Partial<Pick<CreateProjectInput, "status" | "ipAddress">>
  ) {
    return this.prisma.cloudProject.update({
      where: { id },
      data: input,
      include: projectInclude
    }) as Promise<CloudProjectWithSecurityGroups>;
  }

  async delete(id: string) {
    await this.prisma.cloudProject.delete({
      where: { id }
    });
  }
}
