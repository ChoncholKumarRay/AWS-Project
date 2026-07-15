import type { SecurityProtocol, SecurityRuleDirection } from "@local-cloud/shared";
import { ipv4MatchesCidr } from "./cidr.js";

export type PolicyRule = {
  direction: SecurityRuleDirection;
  protocol: SecurityProtocol;
  fromPort: number | null;
  toPort: number | null;
  sourceIp: string;
};

export type PolicyGroup = {
  id: string;
  name: string;
  rules: PolicyRule[];
};

export type TrafficRequest = {
  direction: SecurityRuleDirection;
  protocol: SecurityProtocol;
  port: number;
  sourceIp: string;
};

export type EvaluationResult =
  | {
      allowed: true;
      reason: string;
    }
  | {
      allowed: false;
      reason: string;
    };

export function evaluateSecurityGroups(
  groups: PolicyGroup[],
  traffic: TrafficRequest
): EvaluationResult {
  try {
    if (groups.length === 0) {
      return {
        allowed: true,
        reason: "No security groups attached; unmanaged allow-all"
      };
    }

    for (const group of groups) {
      for (const rule of group.rules) {
        if (ruleMatchesTraffic(rule, traffic)) {
          return {
            allowed: true,
            reason: `Allowed by ${group.name}`
          };
        }
      }
    }

    return {
      allowed: false,
      reason: "No security group rule matched"
    };
  } catch {
    return {
      allowed: false,
      reason: "Security group policy could not be evaluated"
    };
  }
}

export function ruleMatchesTraffic(rule: PolicyRule, traffic: TrafficRequest) {
  if (rule.direction !== traffic.direction) {
    return false;
  }

  if (rule.protocol !== "ALL" && traffic.protocol !== "ALL" && rule.protocol !== traffic.protocol) {
    return false;
  }

  if (rule.protocol !== "ICMP" && rule.protocol !== "ALL") {
    const fromPort = rule.fromPort ?? rule.toPort ?? 0;
    const toPort = rule.toPort ?? rule.fromPort ?? 65535;

    if (traffic.port < fromPort || traffic.port > toPort) {
      return false;
    }
  }

  return ipv4MatchesCidr(traffic.sourceIp, rule.sourceIp);
}
