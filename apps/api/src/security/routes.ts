import { Router } from "express";
import type {
  CreateSecurityGroupRequest,
  CreateSecurityRuleRequest,
  ReplaceProjectSecurityGroupsRequest,
  SecurityGroupListResponse,
  UpdateSecurityGroupRequest
} from "@local-cloud/shared";
import { normalizeClientIp } from "./cidr.js";
import type { SecurityGroupService } from "./service.js";
import { mapServiceError } from "../projects/service.js";

export function createSecurityGroupRouter(service: SecurityGroupService) {
  const router = Router();

  router.get("/security-groups", async (_request, response) => {
    await sendResponse(response, async () => {
      const securityGroups = await service.listGroups();
      return { securityGroups } satisfies SecurityGroupListResponse;
    });
  });

  router.get("/security-groups/whoami", (request, response) => {
    response.json({
      ipAddress: normalizeClientIp(
        request.headers["x-forwarded-for"]?.toString() ?? request.socket.remoteAddress
      )
    });
  });

  router.post("/security-groups", async (request, response) => {
    await sendResponse(response, async () => {
      return await service.createGroup(request.body as CreateSecurityGroupRequest);
    });
  });

  router.put("/security-groups/:id", async (request, response) => {
    await sendResponse(response, async () => {
      return await service.updateGroup(
        request.params.id,
        request.body as UpdateSecurityGroupRequest
      );
    });
  });

  router.delete("/security-groups/:id", async (request, response) => {
    await sendResponse(response, async () => {
      await service.deleteGroup(request.params.id);
      return { id: request.params.id, deleted: true };
    });
  });

  router.post("/security-groups/:id/rules", async (request, response) => {
    await sendResponse(response, async () => {
      return await service.addRule(
        request.params.id,
        request.body as CreateSecurityRuleRequest
      );
    });
  });

  router.delete("/security-groups/:id/rules/:ruleId", async (request, response) => {
    await sendResponse(response, async () => {
      return await service.deleteRule(request.params.id, request.params.ruleId);
    });
  });

  router.get("/projects/:id/security-groups", async (request, response) => {
    await sendResponse(response, async () => {
      const securityGroups = await service.getAttachedGroups(request.params.id);
      return { securityGroups } satisfies SecurityGroupListResponse;
    });
  });

  router.put("/projects/:id/security-groups", async (request, response) => {
    await sendResponse(response, async () => {
      const body = request.body as ReplaceProjectSecurityGroupsRequest;
      const securityGroups = await service.replaceAttachedGroups(
        request.params.id,
        Array.isArray(body.securityGroupIds) ? body.securityGroupIds : []
      );
      return { securityGroups } satisfies SecurityGroupListResponse;
    });
  });

  return router;
}

async function sendResponse<T>(
  response: { status(code: number): typeof response; json(body: unknown): void },
  handler: () => Promise<T> | T
) {
  try {
    response.json(await handler());
  } catch (error) {
    const httpError = mapServiceError(error);
    response.status(httpError.statusCode).json({
      error: httpError.message,
      details: httpError.details
    });
  }
}
