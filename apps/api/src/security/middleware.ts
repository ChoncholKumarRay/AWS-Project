import type { Request, Response, NextFunction } from "express";
import { normalizeClientIp } from "./cidr.js";
import type { ProjectRepository } from "../projects/repository.js";
import type { SecurityPolicyService } from "./service.js";

export function createSecurityGroupMiddleware(
  repository: ProjectRepository,
  policyService: SecurityPolicyService
) {
  return async function enforceSecurityGroup(
    request: Request,
    response: Response,
    next: NextFunction
  ) {
    const projectId = request.params.id;
    const sourceIp = normalizeClientIp(
      request.headers["x-forwarded-for"]?.toString() ?? request.socket.remoteAddress
    );

    if (!sourceIp) {
      response.status(403).json({
        error: "Blocked by Security Group",
        reason: "Client IP could not be determined",
        sourceIp: null
      });
      return;
    }

    try {
      if (typeof projectId !== "string") {
        throw new Error("Missing project id");
      }

      const project = await repository.findById(projectId);

      if (!project) {
        next();
        return;
      }

      const result = await policyService.evaluateProject(project, {
        direction: "INBOUND",
        protocol: "TCP",
        port: 22,
        sourceIp
      });

      if (!result.allowed) {
        response.status(403).json({
          error: "Blocked by Security Group",
          reason: result.reason,
          sourceIp
        });
        return;
      }

      next();
    } catch {
      response.status(403).json({
        error: "Blocked by Security Group",
        reason: "Security group policy could not be evaluated",
        sourceIp
      });
    }
  };
}
