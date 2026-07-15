import { describe, expect, it } from "vitest";
import { createUniqueInstanceName, sanitizeHostnameBase } from "./hostname.js";

describe("Multipass hostname helpers", () => {
  it("sanitizes display names into hostname-safe bases", () => {
    expect(sanitizeHostnameBase("My Server!!")).toBe("my-server");
    expect(sanitizeHostnameBase("  ---  ")).toBe("cloud-instance");
  });

  it("appends a unique suffix while respecting hostname length", () => {
    const name = createUniqueInstanceName("My Server", "a3f9");

    expect(name).toBe("my-server-a3f9");
    expect(name.length).toBeLessThanOrEqual(63);
  });
});
