import { describe, expect, it } from "vitest";
import {
  DEFAULT_INSTANCE_TYPE,
  getInstanceTypeSpec,
  INSTANCE_TYPES,
  isInstanceTypeId
} from "./index.js";

describe("instance type catalog", () => {
  it("exposes t2.micro as the default type", () => {
    expect(DEFAULT_INSTANCE_TYPE).toBe("t2.micro");
    expect(INSTANCE_TYPES[DEFAULT_INSTANCE_TYPE]).toMatchObject({
      vcpu: 1,
      memoryMb: 1024
    });
  });

  it("resolves authoritative specs from the shared catalog", () => {
    expect(getInstanceTypeSpec("t2.medium")).toEqual({
      label: "t2.medium",
      vcpu: 2,
      memoryMb: 4096,
      memoryLabel: "4 GB"
    });
  });

  it("rejects unknown instance type names", () => {
    expect(isInstanceTypeId("m7i.48xlarge")).toBe(false);
    expect(() => getInstanceTypeSpec("m7i.48xlarge")).toThrow(
      "Unknown instance type"
    );
  });
});
