-- CreateEnum
CREATE TYPE "InstanceStatus" AS ENUM ('RUNNING', 'STOPPED');

-- CreateEnum
CREATE TYPE "SecurityRuleDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "SecurityProtocol" AS ENUM ('TCP', 'UDP', 'ICMP', 'ALL');

-- CreateTable
CREATE TABLE "CloudProject" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "InstanceStatus" NOT NULL,
    "instanceName" TEXT NOT NULL,
    "ipAddress" TEXT,
    "instanceType" TEXT NOT NULL,
    "vcpu" INTEGER NOT NULL,
    "memoryMb" INTEGER NOT NULL,
    "publicKey" TEXT,
    "keyFingerprint" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CloudProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SecurityGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityRule" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "direction" "SecurityRuleDirection" NOT NULL DEFAULT 'INBOUND',
    "protocol" "SecurityProtocol" NOT NULL,
    "fromPort" INTEGER,
    "toPort" INTEGER,
    "sourceIp" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SecurityRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectSecurityGroup" (
    "projectId" TEXT NOT NULL,
    "securityGroupId" TEXT NOT NULL,
    "attachedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectSecurityGroup_pkey" PRIMARY KEY ("projectId","securityGroupId")
);

-- CreateIndex
CREATE UNIQUE INDEX "CloudProject_instanceName_key" ON "CloudProject"("instanceName");

-- CreateIndex
CREATE INDEX "CloudProject_status_idx" ON "CloudProject"("status");

-- CreateIndex
CREATE INDEX "CloudProject_instanceName_idx" ON "CloudProject"("instanceName");

-- CreateIndex
CREATE UNIQUE INDEX "SecurityGroup_name_key" ON "SecurityGroup"("name");

-- CreateIndex
CREATE INDEX "SecurityRule_groupId_idx" ON "SecurityRule"("groupId");

-- CreateIndex
CREATE INDEX "ProjectSecurityGroup_securityGroupId_idx" ON "ProjectSecurityGroup"("securityGroupId");

-- AddForeignKey
ALTER TABLE "SecurityRule" ADD CONSTRAINT "SecurityRule_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "SecurityGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectSecurityGroup" ADD CONSTRAINT "ProjectSecurityGroup_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CloudProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectSecurityGroup" ADD CONSTRAINT "ProjectSecurityGroup_securityGroupId_fkey" FOREIGN KEY ("securityGroupId") REFERENCES "SecurityGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
