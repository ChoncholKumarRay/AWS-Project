import { describe, expect, it } from "vitest";
import {
  isMissingInstanceError,
  MultipassClient,
  MultipassCommandError,
  parseMultipassList,
  parseMultipassInfo,
  type MultipassRunOptions,
  type MultipassRunResult
} from "./client.js";

describe("Multipass client helpers", () => {
  it("uses argument arrays for lifecycle commands", async () => {
    const client = new CapturingMultipassClient();

    await client.launch({
      name: "web-a3f9",
      vcpu: 2,
      memoryMb: 4096,
      cloudInit: "#cloud-config\n"
    });
    await client.start("web-a3f9");
    await client.stop("web-a3f9");
    await client.deletePurge("web-a3f9");

    expect(client.calls).toEqual([
      {
        args: [
          "launch",
          "--name",
          "web-a3f9",
          "--cpus",
          "2",
          "--memory",
          "4096M",
          "--cloud-init",
          "-"
        ],
        options: { stdin: "#cloud-config\n", timeoutMs: undefined }
      },
      { args: ["start", "web-a3f9"], options: { timeoutMs: undefined } },
      { args: ["stop", "web-a3f9"], options: { timeoutMs: undefined } },
      {
        args: ["delete", "--purge", "web-a3f9"],
        options: { timeoutMs: undefined }
      }
    ]);
  });

  it("parses the IPv4 addresses from multipass info json", () => {
    const info = parseMultipassInfo(
      "web-a3f9",
      JSON.stringify({
        info: {
          "web-a3f9": {
            state: "Running",
            ipv4: ["10.176.164.20", "not-an-ip"]
          }
        }
      })
    );

    expect(info).toEqual({
      name: "web-a3f9",
      state: "Running",
      ipv4: ["10.176.164.20"],
      cpuCount: null,
      loadAverage: [],
      memory: null,
      disks: []
    });
  });

  it("parses instance names from multipass list json", () => {
    expect(
      parseMultipassList(
        JSON.stringify({
          list: [
            { name: "web-server-5747" },
            { name: "web-server2-826d" },
            { name: "" },
            {}
          ]
        })
      )
    ).toEqual(["web-server-5747", "web-server2-826d"]);
  });

  it("parses CPU, memory, disk, and load metrics from multipass info json", () => {
    const info = parseMultipassInfo(
      "web-a3f9",
      JSON.stringify({
        info: {
          "web-a3f9": {
            state: "Running",
            cpu_count: "2",
            load: [0.5, 0.25, 0.1],
            memory: {
              used: 512,
              total: 1024
            },
            disks: {
              sda1: {
                used: "2048",
                total: "4096"
              }
            },
            ipv4: ["10.176.164.20"]
          }
        }
      })
    );

    expect(info).toMatchObject({
      cpuCount: 2,
      loadAverage: [0.5, 0.25, 0.1],
      memory: {
        usedBytes: 512,
        totalBytes: 1024
      },
      disks: [
        {
          name: "sda1",
          usedBytes: 2048,
          totalBytes: 4096
        }
      ]
    });
  });

  it("detects missing VM errors for terminate self-healing", () => {
    const error = new MultipassCommandError(
      "multipass delete failed",
      ["delete", "--purge", "missing"],
      2,
      "instance 'missing' does not exist"
    );

    expect(isMissingInstanceError(error)).toBe(true);
  });
});

class CapturingMultipassClient extends MultipassClient {
  calls: Array<{ args: string[]; options: MultipassRunOptions }> = [];

  protected override async run(
    args: string[],
    options: MultipassRunOptions = {}
  ): Promise<MultipassRunResult> {
    this.calls.push({ args, options });
    return { stdout: "", stderr: "" };
  }
}
