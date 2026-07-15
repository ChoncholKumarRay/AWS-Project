import {
  DEFAULT_INSTANCE_TYPE,
  getInstanceTypeSpec,
  INSTANCE_TYPES,
  isInstanceTypeId,
  type CloudProjectDto,
  type InstanceTypeCatalogResponse,
  type InstanceTypeId,
  type LaunchProjectRequest,
  type LaunchProjectResponse
} from "@local-cloud/shared";
import { toCloudProjectDto } from "../db/dto.js";
import { isTransientDatabaseError, withDbRetry } from "../db/retry.js";
import { HttpError } from "../errors.js";
import {
  NodeCryptoKeyPairService,
  type KeyPairService
} from "../keys/keyPair.js";
import {
  isMissingInstanceError,
  MultipassClient,
  MultipassCommandError,
  type MultipassInfo
} from "../multipass/client.js";
import { createUniqueInstanceName } from "../multipass/hostname.js";
import type { ProjectRepository } from "./repository.js";

const LAUNCH_TIMEOUT_MS = 5 * 60 * 1000;
const ACTION_TIMEOUT_MS = 2.5 * 60 * 1000;
const INFO_TIMEOUT_MS = 15 * 1000;
const IP_POLL_ATTEMPTS = 30;
const IP_POLL_DELAY_MS = 2000;
const MEMORY_MATCH_TOLERANCE = 0.2;

export type ProjectServiceOptions = {
  repository: ProjectRepository;
  multipass: MultipassClient;
  keyPairService?: KeyPairService;
  sleep?: (delayMs: number) => Promise<void>;
};

export class ProjectService {
  private readonly repository: ProjectRepository;
  private readonly multipass: MultipassClient;
  private readonly keyPairService: KeyPairService;
  private readonly sleep: (delayMs: number) => Promise<void>;

  constructor(options: ProjectServiceOptions) {
    this.repository = options.repository;
    this.multipass = options.multipass;
    this.keyPairService = options.keyPairService ?? new NodeCryptoKeyPairService();
    this.sleep = options.sleep ?? defaultSleep;
  }

  getInstanceTypes(): InstanceTypeCatalogResponse {
    return {
      defaultType: DEFAULT_INSTANCE_TYPE,
      types: Object.values(INSTANCE_TYPES)
    };
  }

  async listProjects(): Promise<CloudProjectDto[]> {
    await this.reconcileMultipassInstances();
    const projects = await withDbRetry(() => this.repository.list());
    return projects.map(toCloudProjectDto);
  }

  async launchProject(input: LaunchProjectRequest): Promise<LaunchProjectResponse> {
    const name = normalizeName(input.name);
    const instanceType = input.instanceType ?? DEFAULT_INSTANCE_TYPE;
    const spec = getInstanceTypeSpec(instanceType);
    const instanceName = createUniqueInstanceName(name);
    const keyPair = this.keyPairService.generateInstanceKeyPair();

    await this.multipass.launch({
      name: instanceName,
      vcpu: spec.vcpu,
      memoryMb: spec.memoryMb,
      cloudInit: buildCloudInit(keyPair.publicKeyOpenSsh),
      timeoutMs: LAUNCH_TIMEOUT_MS
    });

    const ipAddress = await this.pollForIpv4(instanceName);

    const project = await withDbRetry(() =>
      this.repository.create({
        name,
        description: normalizeDescription(input.description),
        status: "RUNNING",
        instanceName,
        ipAddress,
        instanceType,
        vcpu: spec.vcpu,
        memoryMb: spec.memoryMb,
        publicKey: keyPair.publicKeyOpenSsh,
        keyFingerprint: keyPair.fingerprint
      })
    );

    return {
      project: toCloudProjectDto(project),
      privateKeyPem: keyPair.privateKeyPem,
      privateKeyFileName: `${createKeyFileBaseName(name)}-key.pem`
    };
  }

  async startProject(id: string): Promise<CloudProjectDto> {
    const project = await this.requireProject(id);

    await this.multipass.start(project.instanceName, ACTION_TIMEOUT_MS);
    const ipAddress = await this.pollForIpv4(project.instanceName);
    const updated = await withDbRetry(() =>
      this.repository.update(id, {
        status: "RUNNING",
        ipAddress
      })
    );

    return toCloudProjectDto(updated);
  }

  async stopProject(id: string): Promise<CloudProjectDto> {
    const project = await this.requireProject(id);

    await this.multipass.stop(project.instanceName, ACTION_TIMEOUT_MS);
    const updated = await withDbRetry(() =>
      this.repository.update(id, {
        status: "STOPPED"
      })
    );

    return toCloudProjectDto(updated);
  }

  async terminateProject(id: string): Promise<void> {
    const project = await withDbRetry(() => this.repository.findById(id));

    if (!project) {
      throw new HttpError(404, "Project not found");
    }

    try {
      await this.multipass.deletePurge(project.instanceName, ACTION_TIMEOUT_MS);
    } catch (error) {
      if (!isMissingInstanceError(error)) {
        throw error;
      }
    }

    await withDbRetry(() => this.repository.delete(id));
  }

  private async requireProject(id: string) {
    const project = await withDbRetry(() => this.repository.findById(id));

    if (!project) {
      throw new HttpError(404, "Project not found");
    }

    return project;
  }

  private async pollForIpv4(instanceName: string): Promise<string | null> {
    for (let attempt = 1; attempt <= IP_POLL_ATTEMPTS; attempt += 1) {
      const info = await this.multipass.info(instanceName, INFO_TIMEOUT_MS);
      const ipv4 = selectPrimaryIpv4(info);

      if (ipv4) {
        return ipv4;
      }

      if (attempt < IP_POLL_ATTEMPTS) {
        await this.sleep(IP_POLL_DELAY_MS);
      }
    }

    throw new HttpError(
      504,
      `Timed out waiting for IPv4 address for ${instanceName}`
    );
  }

  private async reconcileMultipassInstances() {
    const instances = await this.multipass.listInfo(INFO_TIMEOUT_MS);

    for (const instance of instances) {
      const existing = await withDbRetry(() =>
        this.repository.findByInstanceName(instance.name)
      );
      const status = toProjectStatus(instance.state);
      const ipAddress = selectPrimaryIpv4(instance);

      if (existing) {
        if (existing.status !== status || existing.ipAddress !== ipAddress) {
          await withDbRetry(() =>
            this.repository.update(existing.id, {
              status,
              ipAddress
            })
          );
        }
        continue;
      }

      const instanceType = inferInstanceType(instance);
      const spec = getInstanceTypeSpec(instanceType);

      await withDbRetry(() =>
        this.repository.create({
          name: displayNameFromInstanceName(instance.name),
          description: "Adopted from existing Multipass VM",
          status,
          instanceName: instance.name,
          ipAddress,
          instanceType,
          vcpu: instance.cpuCount ?? spec.vcpu,
          memoryMb: memoryBytesToMb(instance.memory?.totalBytes) ?? spec.memoryMb,
          publicKey: null,
          keyFingerprint: null
        })
      );
    }
  }
}

export function normalizeName(name: string): string {
  const normalized = name.trim();

  if (!normalized) {
    throw new HttpError(400, "Project name is required");
  }

  return normalized;
}

export function normalizeInstanceType(value: unknown): InstanceTypeId | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new HttpError(400, "instanceType must be a string");
  }

  getInstanceTypeSpec(value);
  return value as InstanceTypeId;
}

export function selectPrimaryIpv4(info: MultipassInfo) {
  return info.ipv4[0] ?? null;
}

export function inferInstanceType(info: MultipassInfo): InstanceTypeId {
  const vcpu = info.cpuCount ?? 1;
  const memoryMb = memoryBytesToMb(info.memory?.totalBytes);
  const exactOrCloseMatch = Object.entries(INSTANCE_TYPES).find(([, spec]) => {
    const memoryMatches =
      memoryMb === null
        ? true
        : Math.abs(memoryMb - spec.memoryMb) / spec.memoryMb <=
          MEMORY_MATCH_TOLERANCE;

    return spec.vcpu === vcpu && memoryMatches;
  })?.[0];

  if (exactOrCloseMatch && isInstanceTypeId(exactOrCloseMatch)) {
    return exactOrCloseMatch;
  }

  return DEFAULT_INSTANCE_TYPE;
}

export function buildCloudInit(publicKeyOpenSsh: string) {
  return [
    "#cloud-config",
    "package_update: false",
    "users:",
    "  - default",
    "ssh_authorized_keys:",
    `  - ${publicKeyOpenSsh}`,
    ""
  ].join("\n");
}

export function mapServiceError(error: unknown): HttpError {
  if (error instanceof HttpError) {
    return error;
  }

  if (error instanceof MultipassCommandError) {
    const timedOut = error.message.toLowerCase().includes("timed out");

    return new HttpError(
      timedOut ? 504 : 502,
      timedOut
        ? "Multipass VM command timed out. Check the VM state and try again."
        : "Multipass command failed. Verify Multipass is installed, running, and accessible from this host.",
      {
        command: ["multipass", ...error.args],
        exitCode: error.exitCode,
        stderr: error.stderr
      }
    );
  }

  if (isMissingMultipassError(error)) {
    return new HttpError(
      503,
      "Multipass CLI was not found. Install Multipass on this host and ensure `multipass` is on PATH."
    );
  }

  if (isMissingDatabaseUrlError(error)) {
    return new HttpError(
      503,
      "DATABASE_URL is missing. Add your Neon PostgreSQL connection string to .env and restart the API."
    );
  }

  if (isTransientDatabaseError(error)) {
    return new HttpError(503, "Database connection failed. Check your Neon connection and try again.", {
      code: getErrorCode(error)
    });
  }

  if (error instanceof SyntaxError) {
    return new HttpError(502, "Multipass returned output that the API could not parse.");
  }

  if (error instanceof Error && error.message.includes("multipass info did not include")) {
    return new HttpError(502, "Multipass did not return information for the requested VM.");
  }

  if (error instanceof Error && error.message.startsWith("Unknown instance type")) {
    return new HttpError(400, error.message);
  }

  return new HttpError(500, "Internal server error");
}

export function formatStartupError(error: unknown) {
  const httpError = mapServiceError(error);

  return `Local Cloud API failed to start: ${httpError.message}`;
}

function isMissingMultipassError(error: unknown) {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT" &&
    error.message.includes("multipass")
  );
}

function isMissingDatabaseUrlError(error: unknown) {
  return (
    error instanceof Error &&
    error.message === "DATABASE_URL is required to create the Prisma client."
  );
}

function getErrorCode(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return undefined;
  }

  const code = error.code;
  return typeof code === "string" ? code : undefined;
}

function normalizeDescription(description: string | undefined) {
  const normalized = description?.trim();
  return normalized ? normalized : null;
}

function createKeyFileBaseName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "cloud-instance";
}

function toProjectStatus(state: string | null): "RUNNING" | "STOPPED" {
  return state?.toLowerCase() === "running" ? "RUNNING" : "STOPPED";
}

function memoryBytesToMb(value: number | undefined) {
  if (value === undefined) {
    return null;
  }

  return Math.round(value / 1024 / 1024);
}

function displayNameFromInstanceName(instanceName: string) {
  const withoutSuffix = instanceName.replace(/-[a-f0-9]{4}$/i, "");
  const displayName = withoutSuffix.replace(/-/g, " ").trim();
  return displayName || instanceName;
}

function defaultSleep(delayMs: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  });
}
