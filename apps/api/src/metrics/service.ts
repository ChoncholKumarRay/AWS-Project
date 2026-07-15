import type { ProjectMetricsDto } from "@local-cloud/shared";
import { withDbRetry } from "../db/retry.js";
import { HttpError } from "../errors.js";
import type { MultipassClient, MultipassInfo } from "../multipass/client.js";
import type { ProjectRepository } from "../projects/repository.js";
import { nextRandomWalkValue } from "./randomWalk.js";

const INFO_TIMEOUT_MS = 15 * 1000;

type SimulatedMetricState = {
  networkIn: number;
  networkOut: number;
  diskRead: number;
  diskWrite: number;
};

export class MetricsService {
  private readonly simulated = new Map<string, SimulatedMetricState>();

  constructor(
    private readonly repository: ProjectRepository,
    private readonly multipass: MultipassClient
  ) {}

  async getProjectMetrics(projectId: string): Promise<ProjectMetricsDto> {
    const project = await withDbRetry(() => this.repository.findById(projectId));

    if (!project) {
      throw new HttpError(404, "Project not found");
    }

    if (project.status !== "RUNNING") {
      throw new HttpError(409, "Metrics are available only for RUNNING instances");
    }

    const info = await this.multipass.info(project.instanceName, INFO_TIMEOUT_MS);

    if (info.state && info.state.toLowerCase() !== "running") {
      throw new HttpError(409, "Instance is not running");
    }

    return buildMetricsDto(projectId, project.instanceName, info, this.nextSimulated(projectId));
  }

  private nextSimulated(projectId: string): SimulatedMetricState {
    const current =
      this.simulated.get(projectId) ??
      ({
        networkIn: 2048,
        networkOut: 1536,
        diskRead: 4096,
        diskWrite: 2048
      } satisfies SimulatedMetricState);
    const next = {
      networkIn: nextRandomWalkValue({
        value: current.networkIn,
        min: 0,
        max: 256 * 1024,
        step: 16 * 1024
      }),
      networkOut: nextRandomWalkValue({
        value: current.networkOut,
        min: 0,
        max: 256 * 1024,
        step: 16 * 1024
      }),
      diskRead: nextRandomWalkValue({
        value: current.diskRead,
        min: 0,
        max: 512 * 1024,
        step: 32 * 1024
      }),
      diskWrite: nextRandomWalkValue({
        value: current.diskWrite,
        min: 0,
        max: 512 * 1024,
        step: 32 * 1024
      })
    };

    this.simulated.set(projectId, next);
    return next;
  }
}

export function buildMetricsDto(
  projectId: string,
  instanceName: string,
  info: MultipassInfo,
  simulated: SimulatedMetricState
): ProjectMetricsDto {
  const vcpu = Math.max(info.cpuCount ?? 1, 1);
  const loadAverage1m = info.loadAverage[0] ?? 0;
  const primaryDisk = summarizeDisks(info.disks);
  const memory = info.memory ?? { usedBytes: 0, totalBytes: 0 };

  return {
    projectId,
    instanceName,
    timestamp: new Date().toISOString(),
    cpu: {
      utilizationPercent: percentage(loadAverage1m, vcpu),
      loadAverage1m,
      vcpu
    },
    memory: {
      ...memory,
      utilizationPercent: percentage(memory.usedBytes, memory.totalBytes)
    },
    disk: {
      ...primaryDisk,
      utilizationPercent: percentage(primaryDisk.usedBytes, primaryDisk.totalBytes)
    },
    network: {
      inBytesPerSecond: simulated.networkIn,
      outBytesPerSecond: simulated.networkOut
    },
    diskIo: {
      readBytesPerSecond: simulated.diskRead,
      writeBytesPerSecond: simulated.diskWrite
    }
  };
}

function summarizeDisks(disks: MultipassInfo["disks"]) {
  return disks.reduce(
    (total, disk) => ({
      usedBytes: total.usedBytes + disk.usedBytes,
      totalBytes: total.totalBytes + disk.totalBytes
    }),
    { usedBytes: 0, totalBytes: 0 }
  );
}

function percentage(used: number, total: number) {
  if (total <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(100, (used / total) * 100));
}
