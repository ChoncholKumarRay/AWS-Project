import cors from "cors";
import express from "express";
import helmet from "helmet";
import { APP_NAME } from "@local-cloud/shared";
import { getPrismaClient } from "./db/client.js";
import { NodeCryptoKeyPairService } from "./keys/keyPair.js";
import { MetricsService } from "./metrics/service.js";
import { MultipassClient } from "./multipass/client.js";
import {
  PrismaProjectRepository,
  type ProjectRepository
} from "./projects/repository.js";
import { createProjectRouter } from "./projects/routes.js";
import { ProjectService } from "./projects/service.js";
import { createSecurityGroupMiddleware } from "./security/middleware.js";
import { createSecurityGroupRouter } from "./security/routes.js";
import { SecurityGroupService, SecurityPolicyService } from "./security/service.js";

export type AppDependencies = {
  projectService?: ProjectService;
  projectRepository?: ProjectRepository;
  metricsService?: MetricsService;
  securityGroupService?: SecurityGroupService;
  securityPolicyService?: SecurityPolicyService;
};

export function createApp(dependencies: AppDependencies = {}) {
  const app = express();
  const projectService =
    dependencies.projectService ?? createProjectService(dependencies.projectRepository);
  const metricsService =
    dependencies.metricsService ?? createMetricsService(dependencies.projectRepository);
  const securityGroupService =
    dependencies.securityGroupService ?? createSecurityGroupService();
  const securityPolicyService =
    dependencies.securityPolicyService ?? new SecurityPolicyService();
  const repository =
    dependencies.projectRepository ?? new PrismaProjectRepository(getPrismaClient());

  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  app.get("/", (_request, response) => {
    response.json({
      name: APP_NAME,
      status: "ok"
    });
  });

  app.get("/api/health", (_request, response) => {
    response.json({
      status: "ok",
      service: "api"
    });
  });

  app.use("/api", createSecurityGroupRouter(securityGroupService));
  app.use(
    "/api",
    createProjectRouter(
      projectService,
      metricsService,
      createSecurityGroupMiddleware(repository, securityPolicyService)
    )
  );

  return app;
}

function createProjectService(projectRepository?: ProjectRepository) {
  return new ProjectService({
    repository: projectRepository ?? new PrismaProjectRepository(getPrismaClient()),
    multipass: new MultipassClient(),
    keyPairService: new NodeCryptoKeyPairService()
  });
}

function createMetricsService(projectRepository?: ProjectRepository) {
  return new MetricsService(
    projectRepository ?? new PrismaProjectRepository(getPrismaClient()),
    new MultipassClient()
  );
}

function createSecurityGroupService() {
  return new SecurityGroupService(getPrismaClient());
}
