import { Router } from "express";
import type { Request, Response, RequestHandler } from "express";
import {
  type LaunchProjectRequest,
  type LaunchProjectResponse,
  type ListProjectsResponse,
  type ProjectMetricsDto,
  type ProjectActionResponse,
  type TerminateProjectResponse
} from "@local-cloud/shared";
import type { MetricsService } from "../metrics/service.js";
import { mapServiceError, normalizeInstanceType, ProjectService } from "./service.js";

export function createProjectRouter(
  service: ProjectService,
  metricsService: MetricsService,
  enforceSecurityGroup: RequestHandler
) {
  const router = Router();

  router.get("/instance-types", (_request, response) => {
    response.json(service.getInstanceTypes());
  });

  router.get("/projects", async (_request, response) => {
    await sendResponse(response, async () => {
      const projects = await service.listProjects();
      return {
        projects
      } satisfies ListProjectsResponse;
    });
  });

  router.post("/projects", async (request, response) => {
    await sendResponse(response, async () => {
      const body = parseLaunchBody(request);
      return (await service.launchProject(body)) satisfies LaunchProjectResponse;
    });
  });

  router.post("/projects/:id/start", enforceSecurityGroup, async (request, response) => {
    await sendResponse(response, async () => {
      const project = await service.startProject(getParam(request, "id"));
      return {
        project
      } satisfies ProjectActionResponse;
    });
  });

  router.post("/projects/:id/stop", enforceSecurityGroup, async (request, response) => {
    await sendResponse(response, async () => {
      const project = await service.stopProject(getParam(request, "id"));
      return {
        project
      } satisfies ProjectActionResponse;
    });
  });

  router.get("/projects/:id/metrics", enforceSecurityGroup, async (request, response) => {
    await sendResponse(response, async () => {
      return (await metricsService.getProjectMetrics(
        getParam(request, "id")
      )) satisfies ProjectMetricsDto;
    });
  });

  router.post("/projects/:id/terminate", enforceSecurityGroup, async (request, response) => {
    await sendResponse(response, async () => {
      const id = getParam(request, "id");
      await service.terminateProject(id);
      return {
        id,
        terminated: true
      } satisfies TerminateProjectResponse;
    });
  });

  router.delete("/projects/:id", enforceSecurityGroup, async (request, response) => {
    await sendResponse(response, async () => {
      const id = getParam(request, "id");
      await service.terminateProject(id);
      return {
        id,
        terminated: true
      } satisfies TerminateProjectResponse;
    });
  });

  return router;
}

function getParam(request: Request, key: string) {
  const value = request.params[key];

  if (typeof value !== "string") {
    throw new Error(`Missing route parameter: ${key}`);
  }

  return value;
}

function parseLaunchBody(request: Request): LaunchProjectRequest {
  const body = request.body as Record<string, unknown>;

  return {
    name: typeof body.name === "string" ? body.name : "",
    description:
      typeof body.description === "string" ? body.description : undefined,
    instanceType: normalizeInstanceType(body.instanceType)
  };
}

async function sendResponse<T>(
  response: Response,
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
