import { describe, expect, it } from "vitest";
import { evaluateSecurityGroups, ruleMatchesTraffic } from "./evaluator.js";

describe("security group evaluator", () => {
  it("allows all traffic for zero attached groups", () => {
    expect(
      evaluateSecurityGroups([], {
        direction: "INBOUND",
        protocol: "TCP",
        port: 22,
        sourceIp: "203.0.113.7"
      })
    ).toMatchObject({ allowed: true });
  });

  it("matches protocol, port range, and source CIDR", () => {
    expect(
      ruleMatchesTraffic(
        {
          direction: "INBOUND",
          protocol: "TCP",
          fromPort: 20,
          toPort: 30,
          sourceIp: "203.0.113.0/24"
        },
        {
          direction: "INBOUND",
          protocol: "TCP",
          port: 22,
          sourceIp: "203.0.113.7"
        }
      )
    ).toBe(true);
  });

  it("unions all attached groups", () => {
    expect(
      evaluateSecurityGroups(
        [
          {
            id: "sg-1",
            name: "http",
            rules: [
              {
                direction: "INBOUND",
                protocol: "TCP",
                fromPort: 80,
                toPort: 80,
                sourceIp: "0.0.0.0/0"
              }
            ]
          },
          {
            id: "sg-2",
            name: "ssh",
            rules: [
              {
                direction: "INBOUND",
                protocol: "TCP",
                fromPort: 22,
                toPort: 22,
                sourceIp: "203.0.113.7/32"
              }
            ]
          }
        ],
        {
          direction: "INBOUND",
          protocol: "TCP",
          port: 22,
          sourceIp: "203.0.113.7"
        }
      )
    ).toMatchObject({ allowed: true });
  });

  it("denies when no rule matches", () => {
    expect(
      evaluateSecurityGroups(
        [
          {
            id: "sg-1",
            name: "http",
            rules: [
              {
                direction: "INBOUND",
                protocol: "TCP",
                fromPort: 80,
                toPort: 80,
                sourceIp: "0.0.0.0/0"
              }
            ]
          }
        ],
        {
          direction: "INBOUND",
          protocol: "TCP",
          port: 22,
          sourceIp: "203.0.113.7"
        }
      )
    ).toMatchObject({ allowed: false });
  });

  it("fails closed on invalid policy data", () => {
    expect(
      evaluateSecurityGroups(
        [
          {
            id: "sg-1",
            name: "bad",
            rules: [
              {
                direction: "INBOUND",
                protocol: "TCP",
                fromPort: 22,
                toPort: 22,
                sourceIp: "not-cidr"
              }
            ]
          }
        ],
        {
          direction: "INBOUND",
          protocol: "TCP",
          port: 22,
          sourceIp: "203.0.113.7"
        }
      )
    ).toMatchObject({ allowed: false });
  });
});
