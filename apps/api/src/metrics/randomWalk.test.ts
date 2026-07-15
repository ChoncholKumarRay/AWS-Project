import { describe, expect, it } from "vitest";
import { nextRandomWalkValue } from "./randomWalk.js";

describe("random walk metrics", () => {
  it("keeps values inside the configured bounds", () => {
    expect(
      nextRandomWalkValue({ value: 95, min: 0, max: 100, step: 20 }, () => 1)
    ).toBe(100);
    expect(
      nextRandomWalkValue({ value: 5, min: 0, max: 100, step: 20 }, () => 0)
    ).toBe(0);
  });

  it("moves by at most the configured step", () => {
    const value = nextRandomWalkValue(
      { value: 1000, min: 0, max: 2000, step: 100 },
      () => 0.75
    );

    expect(value).toBe(1050);
  });
});
