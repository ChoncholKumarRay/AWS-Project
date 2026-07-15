import axios from "axios";
import type {
  CloudProjectDto,
  CreateSecurityGroupRequest,
  CreateSecurityRuleRequest,
  InstanceTypeCatalogResponse,
  LaunchProjectRequest,
  LaunchProjectResponse,
  ListProjectsResponse,
  ProjectActionResponse,
  ProjectMetricsDto,
  ReplaceProjectSecurityGroupsRequest,
  SecurityGroupDto,
  SecurityGroupListResponse,
  TerminateProjectResponse,
  UpdateSecurityGroupRequest,
} from "@local-cloud/shared";

const API_PORT = import.meta.env.VITE_API_PORT ?? "5000";
const LAUNCH_TIMEOUT_MS = 5 * 60 * 1000;
const ACTION_TIMEOUT_MS = 2.5 * 60 * 1000;

export function getApiBaseUrl() {
  const protocol = window.location.protocol === "https:" ? "https:" : "http:";
  return `${protocol}//${window.location.hostname}:${API_PORT}/api`;
}

export function getTerminalWebSocketUrl(projectId: string) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.hostname}:${API_PORT}/api/ws/terminal/${encodeURIComponent(
    projectId,
  )}`;
}

const api = axios.create({
  baseURL: getApiBaseUrl(),
  timeout: ACTION_TIMEOUT_MS,
});

export async function fetchInstanceTypes() {
  const response =
    await api.get<InstanceTypeCatalogResponse>("/instance-types");
  return response.data;
}

export async function fetchProjects() {
  const response = await api.get<ListProjectsResponse>("/projects");
  return response.data.projects;
}

export async function launchProject(input: LaunchProjectRequest) {
  const response = await api.post<LaunchProjectResponse>("/projects", input, {
    timeout: LAUNCH_TIMEOUT_MS,
  });
  return response.data;
}

export async function startProject(id: string) {
  return projectAction(`/projects/${id}/start`);
}

export async function stopProject(id: string) {
  return projectAction(`/projects/${id}/stop`);
}

export async function terminateProject(id: string) {
  const response = await api.post<TerminateProjectResponse>(
    `/projects/${id}/terminate`,
    undefined,
    { timeout: ACTION_TIMEOUT_MS },
  );
  return response.data;
}

export async function fetchProjectMetrics(id: string) {
  const response = await api.get<ProjectMetricsDto>(`/projects/${id}/metrics`);
  return response.data;
}

export async function fetchSecurityGroups() {
  const response = await api.get<SecurityGroupListResponse>("/security-groups");
  return response.data.securityGroups;
}

export async function fetchMyIp() {
  const response = await api.get<{ ipAddress: string }>(
    "/security-groups/whoami",
  );
  return response.data.ipAddress;
}

export async function createSecurityGroup(input: CreateSecurityGroupRequest) {
  const response = await api.post<SecurityGroupDto>("/security-groups", input);
  return response.data;
}

export async function updateSecurityGroup(
  id: string,
  input: UpdateSecurityGroupRequest,
) {
  const response = await api.put<SecurityGroupDto>(
    `/security-groups/${id}`,
    input,
  );
  return response.data;
}

export async function deleteSecurityGroup(id: string) {
  await api.delete(`/security-groups/${id}`);
}

export async function addSecurityRule(
  groupId: string,
  input: CreateSecurityRuleRequest,
) {
  const response = await api.post<SecurityGroupDto>(
    `/security-groups/${groupId}/rules`,
    input,
  );
  return response.data;
}

export async function deleteSecurityRule(groupId: string, ruleId: string) {
  const response = await api.delete<SecurityGroupDto>(
    `/security-groups/${groupId}/rules/${ruleId}`,
  );
  return response.data;
}

export async function fetchProjectSecurityGroups(projectId: string) {
  const response = await api.get<SecurityGroupListResponse>(
    `/projects/${projectId}/security-groups`,
  );
  return response.data.securityGroups;
}

export async function replaceProjectSecurityGroups(
  projectId: string,
  input: ReplaceProjectSecurityGroupsRequest,
) {
  const response = await api.put<SecurityGroupListResponse>(
    `/projects/${projectId}/security-groups`,
    input,
  );
  return response.data.securityGroups;
}

export function getApiErrorMessage(error: unknown) {
  if (
    axios.isAxiosError<{
      error?: string;
      reason?: string;
      sourceIp?: string | null;
      details?: { reason?: string; sourceIp?: string; code?: string };
    }>(error)
  ) {
    const apiError = error.response?.data?.error;
    const responseBody = error.response?.data;
    const details = responseBody?.details;

    if (apiError === "Blocked by Security Group") {
      const sourceIp = details?.sourceIp ?? responseBody?.sourceIp;

      return [
        "Blocked by Security Group",
        details?.reason ?? responseBody?.reason,
        sourceIp ? `Source IP: ${sourceIp}` : undefined,
      ]
        .filter(Boolean)
        .join(". ");
    }

    if (error.code === "ECONNABORTED") {
      return "The operation timed out. Check the VM state and try again.";
    }

    if (!error.response) {
      return "The API is unreachable. Check that the backend is running on port 5000 and reachable from this device.";
    }

    if (apiError) {
      return details?.code ? `${apiError} (${details.code})` : apiError;
    }

    return error.message ?? "The API request could not be completed.";
  }

  return error instanceof Error
    ? error.message
    : "The API request could not be completed.";
}

async function projectAction(path: string): Promise<CloudProjectDto> {
  const response = await api.post<ProjectActionResponse>(path, undefined, {
    timeout: ACTION_TIMEOUT_MS,
  });
  return response.data.project;
}
