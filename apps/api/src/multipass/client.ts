import { spawn } from "node:child_process";
import { spawn as spawnPty } from "node-pty";

export type MultipassRunOptions = {
  stdin?: string;
  timeoutMs?: number;
};

export type MultipassRunResult = {
  stdout: string;
  stderr: string;
};

export class MultipassCommandError extends Error {
  constructor(
    message: string,
    public readonly args: string[],
    public readonly exitCode: number | null,
    public readonly stderr: string
  ) {
    super(message);
  }
}

export type MultipassInfo = {
  name: string;
  state: string | null;
  ipv4: string[];
  cpuCount: number | null;
  loadAverage: number[];
  memory: {
    usedBytes: number;
    totalBytes: number;
  } | null;
  disks: Array<{
    name: string;
    usedBytes: number;
    totalBytes: number;
  }>;
};

export class MultipassClient {
  async launch(options: {
    name: string;
    vcpu: number;
    memoryMb: number;
    cloudInit: string;
    timeoutMs?: number;
  }) {
    await this.run(
      [
        "launch",
        "--name",
        options.name,
        "--cpus",
        String(options.vcpu),
        "--memory",
        `${options.memoryMb}M`,
        "--cloud-init",
        "-"
      ],
      {
        stdin: options.cloudInit,
        timeoutMs: options.timeoutMs
      }
    );
  }

  async start(name: string, timeoutMs?: number) {
    await this.run(["start", name], { timeoutMs });
  }

  async stop(name: string, timeoutMs?: number) {
    await this.run(["stop", name], { timeoutMs });
  }

  async deletePurge(name: string, timeoutMs?: number) {
    await this.run(["delete", "--purge", name], { timeoutMs });
  }

  async info(name: string, timeoutMs?: number): Promise<MultipassInfo> {
    const result = await this.run(["info", name, "--format", "json"], {
      timeoutMs
    });

    return parseMultipassInfo(name, result.stdout);
  }

  async listInfo(timeoutMs?: number): Promise<MultipassInfo[]> {
    const result = await this.run(["list", "--format", "json"], {
      timeoutMs
    });
    const names = parseMultipassList(result.stdout);

    return await Promise.all(names.map((name) => this.info(name, timeoutMs)));
  }

  protected run(args: string[], options: MultipassRunOptions = {}) {
    return runMultipass(args, options);
  }
}

export function runMultipass(
  args: string[],
  options: MultipassRunOptions = {}
): Promise<MultipassRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("multipass", args, {
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let didTimeout = false;
    const timeout =
      options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            didTimeout = true;
            child.kill("SIGTERM");
          }, options.timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      if (timeout) {
        clearTimeout(timeout);
      }
      reject(error);
    });
    child.on("close", (exitCode) => {
      if (timeout) {
        clearTimeout(timeout);
      }

      if (exitCode === 0) {
        if (shouldRetryWithPty(args, options, stdout)) {
          void runMultipassPty(args, options).then(resolve, reject);
          return;
        }

        resolve({ stdout, stderr });
        return;
      }

      reject(
        new MultipassCommandError(
          didTimeout
            ? `multipass ${args[0]} timed out`
            : `multipass ${args[0]} failed`,
          args,
          exitCode,
          stderr
        )
      );
    });

    if (options.stdin) {
      child.stdin.write(options.stdin);
    }

    child.stdin.end();
  });
}

function runMultipassPty(
  args: string[],
  options: MultipassRunOptions = {}
): Promise<MultipassRunResult> {
  return new Promise((resolve, reject) => {
    let output = "";
    let didTimeout = false;
    const terminal = spawnPty("multipass", args, {
      name: "xterm-256color",
      cols: 160,
      rows: 48,
      cwd: process.cwd(),
      env: process.env
    });
    const timeout =
      options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            didTimeout = true;
            terminal.kill();
          }, options.timeoutMs);

    terminal.onData((chunk) => {
      output += chunk;
    });
    terminal.onExit(({ exitCode }) => {
      if (timeout) {
        clearTimeout(timeout);
      }

      const normalizedOutput = output.replace(/\r\n/g, "\n");

      if (exitCode === 0) {
        resolve({ stdout: normalizedOutput, stderr: "" });
        return;
      }

      reject(
        new MultipassCommandError(
          didTimeout
            ? `multipass ${args[0]} timed out`
            : `multipass ${args[0]} failed`,
          args,
          exitCode,
          normalizedOutput
        )
      );
    });
  });
}

function shouldRetryWithPty(
  args: string[],
  options: MultipassRunOptions,
  stdout: string
) {
  return (
    !options.stdin &&
    stdout.length === 0 &&
    (args[0] === "info" || args[0] === "list")
  );
}

export function parseMultipassInfo(name: string, json: string): MultipassInfo {
  const info = parseMultipassInfoRecord(json)[name];

  if (!info) {
    throw new Error(`multipass info did not include instance ${name}`);
  }

  return toMultipassInfo(name, info);
}

export function parseMultipassInfoList(json: string): MultipassInfo[] {
  return Object.entries(parseMultipassInfoRecord(json)).map(([name, info]) =>
    toMultipassInfo(name, info)
  );
}

export function parseMultipassList(json: string): string[] {
  const parsed = JSON.parse(json) as {
    list?: Array<{ name?: string }>;
  };

  return (parsed.list ?? []).flatMap((item) =>
    typeof item.name === "string" && item.name.trim() ? [item.name] : []
  );
}

type RawMultipassInfo = {
  state?: string;
  ipv4?: string[];
  cpu_count?: string | number;
  load?: number[];
  memory?: {
    used?: number;
    total?: number;
  };
  disks?: Record<
    string,
    {
      used?: string | number;
      total?: string | number;
    }
  >;
};

function parseMultipassInfoRecord(json: string): Record<string, RawMultipassInfo> {
  const parsed = JSON.parse(json) as {
    info?: Record<
      string,
      RawMultipassInfo
    >;
  };

  return parsed.info ?? {};
}

function toMultipassInfo(name: string, info: RawMultipassInfo): MultipassInfo {
  return {
    name,
    state: info.state ?? null,
    ipv4: Array.isArray(info.ipv4) ? info.ipv4.filter(isIpv4Address) : [],
    cpuCount: parseNumber(info.cpu_count),
    loadAverage: Array.isArray(info.load)
      ? info.load.filter((value) => Number.isFinite(value))
      : [],
    memory:
      typeof info.memory?.used === "number" && typeof info.memory.total === "number"
        ? {
            usedBytes: info.memory.used,
            totalBytes: info.memory.total
          }
        : null,
    disks: Object.entries(info.disks ?? {}).flatMap(([diskName, disk]) => {
      const usedBytes = parseNumber(disk.used);
      const totalBytes = parseNumber(disk.total);

      if (usedBytes === null || totalBytes === null) {
        return [];
      }

      return [
        {
          name: diskName,
          usedBytes,
          totalBytes
        }
      ];
    })
  };
}

export function isMissingInstanceError(error: unknown) {
  if (!(error instanceof MultipassCommandError)) {
    return false;
  }

  const message = error.stderr.toLowerCase();
  return (
    message.includes("does not exist") ||
    message.includes("not found") ||
    message.includes("no such instance") ||
    message.includes("instance not found")
  );
}

function isIpv4Address(value: string) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value);
}

function parseNumber(value: string | number | undefined) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}
