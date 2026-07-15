import { describe, expect, it, vi } from "vitest";
import { isTransientDatabaseError, withDbRetry } from "./retry.js";

describe("database retry helper", () => {
  it("retries transient connection failures", async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce({ code: "P1001" })
      .mockResolvedValueOnce("ok");
    const sleep = vi.fn<(_delayMs: number) => Promise<void>>().mockResolvedValue();

    await expect(withDbRetry(operation, { sleep })).resolves.toBe("ok");

    expect(operation).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(100);
  });

  it("does not retry logical Prisma errors", async () => {
    const error = { code: "P2025", message: "Record not found" };
    const operation = vi.fn<() => Promise<string>>().mockRejectedValue(error);
    const sleep = vi.fn<(_delayMs: number) => Promise<void>>().mockResolvedValue();

    await expect(withDbRetry(operation, { sleep })).rejects.toBe(error);

    expect(operation).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("identifies common Neon pooler disconnects as transient", () => {
    expect(
      isTransientDatabaseError({ message: "Connection terminated unexpectedly" })
    ).toBe(true);
    expect(isTransientDatabaseError({ code: "ECONNRESET" })).toBe(true);
  });
});
