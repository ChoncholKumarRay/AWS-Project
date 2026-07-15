import { StrictMode, useEffect, useMemo, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import {
  AlertTriangle,
  Activity,
  Check,
  Download,
  KeyRound,
  Loader2,
  Monitor,
  Pencil,
  Play,
  Plus,
  RefreshCcw,
  Shield,
  Square,
  Trash2,
  X
} from "lucide-react";
import "@xterm/xterm/css/xterm.css";
import {
  APP_NAME,
  DEFAULT_INSTANCE_TYPE,
  type CloudProjectDto,
  type CreateSecurityRuleRequest,
  type InstanceTypeCatalogResponse,
  type InstanceTypeId,
  type LaunchProjectResponse,
  type ProjectMetricsDto,
  type SecurityGroupDto,
  type SecurityProtocol
} from "@local-cloud/shared";
import {
  addSecurityRule,
  createSecurityGroup,
  deleteSecurityGroup,
  deleteSecurityRule,
  fetchProjectMetrics,
  fetchInstanceTypes,
  fetchMyIp,
  fetchProjects,
  fetchSecurityGroups,
  getApiBaseUrl,
  getApiErrorMessage,
  getTerminalWebSocketUrl,
  launchProject,
  replaceProjectSecurityGroups,
  startProject,
  stopProject,
  terminateProject,
  updateSecurityGroup
} from "./api.js";
import "./styles.css";

type RowAction = "start" | "stop" | "terminate";
type ActiveTab = "instances" | "security-groups";
type RulePreset = "SSH" | "HTTP" | "HTTPS" | "CUSTOM_TCP" | "ALL";

type LaunchFormState = {
  name: string;
  description: string;
  instanceType: InstanceTypeId;
};

const initialLaunchForm: LaunchFormState = {
  name: "",
  description: "",
  instanceType: DEFAULT_INSTANCE_TYPE
};

type SecurityGroupFormState = {
  name: string;
  description: string;
};

type RuleFormState = {
  preset: RulePreset;
  protocol: SecurityProtocol;
  fromPort: string;
  toPort: string;
  sourceIp: string;
};

const initialSecurityGroupForm: SecurityGroupFormState = {
  name: "",
  description: ""
};

const defaultSourceIp = "0.0.0.0/0";

const initialRuleForm: RuleFormState = {
  preset: "SSH",
  protocol: "TCP",
  fromPort: "22",
  toPort: "22",
  sourceIp: defaultSourceIp
};

function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("instances");
  const [catalog, setCatalog] = useState<InstanceTypeCatalogResponse | null>(null);
  const [projects, setProjects] = useState<CloudProjectDto[]>([]);
  const [securityGroups, setSecurityGroups] = useState<SecurityGroupDto[]>([]);
  const [clientIp, setClientIp] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLaunchOpen, setIsLaunchOpen] = useState(false);
  const [launchForm, setLaunchForm] = useState(initialLaunchForm);
  const [isLaunching, setIsLaunching] = useState(false);
  const [securityGroupForm, setSecurityGroupForm] = useState(
    initialSecurityGroupForm
  );
  const [editingGroups, setEditingGroups] = useState<
    Record<string, SecurityGroupFormState | undefined>
  >({});
  const [ruleForms, setRuleForms] = useState<Record<string, RuleFormState>>({});
  const [securityBusy, setSecurityBusy] = useState<Record<string, boolean>>({});
  const [rowLoading, setRowLoading] = useState<Record<string, RowAction | undefined>>(
    {}
  );
  const [pendingTerminate, setPendingTerminate] = useState<CloudProjectDto | null>(
    null
  );
  const [keyDelivery, setKeyDelivery] = useState<LaunchProjectResponse | null>(null);
  const [terminalProject, setTerminalProject] = useState<CloudProjectDto | null>(
    null
  );
  const [monitorProject, setMonitorProject] = useState<CloudProjectDto | null>(null);
  const [attachProject, setAttachProject] = useState<CloudProjectDto | null>(null);
  const [attachSelection, setAttachSelection] = useState<string[]>([]);
  const [isSavingAttachment, setIsSavingAttachment] = useState(false);

  const runningCount = useMemo(
    () => projects.filter((project) => project.status === "RUNNING").length,
    [projects]
  );

  useEffect(() => {
    void loadInitialData();
  }, []);

  async function loadInitialData() {
    setIsLoading(true);
    setError(null);

    try {
      const [catalogData, projectData, groupData, detectedIp] = await Promise.all([
        fetchInstanceTypes(),
        fetchProjects(),
        fetchSecurityGroups(),
        fetchMyIp()
      ]);
      setCatalog(catalogData);
      setProjects(projectData);
      setSecurityGroups(groupData);
      setClientIp(detectedIp);
      setLaunchForm((current) => ({
        ...current,
        instanceType: catalogData.defaultType
      }));
    } catch (requestError) {
      setError(getApiErrorMessage(requestError));
    } finally {
      setIsLoading(false);
    }
  }

  async function refreshProjects() {
    setIsRefreshing(true);
    setError(null);

    try {
      const [projectData, groupData, detectedIp] = await Promise.all([
        fetchProjects(),
        fetchSecurityGroups(),
        fetchMyIp()
      ]);
      setProjects(projectData);
      setSecurityGroups(groupData);
      setClientIp(detectedIp);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError));
    } finally {
      setIsRefreshing(false);
    }
  }

  async function submitLaunch() {
    setIsLaunching(true);
    setError(null);

    try {
      const result = await launchProject({
        name: launchForm.name,
        description: launchForm.description || undefined,
        instanceType: launchForm.instanceType
      });
      setProjects((current) => [result.project, ...current]);
      setIsLaunchOpen(false);
      setLaunchForm({
        ...initialLaunchForm,
        instanceType: catalog?.defaultType ?? DEFAULT_INSTANCE_TYPE
      });
      setKeyDelivery(result);
      downloadPrivateKey(result.privateKeyPem, result.privateKeyFileName);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError));
    } finally {
      setIsLaunching(false);
    }
  }

  async function runRowAction(project: CloudProjectDto, action: RowAction) {
    setRowLoading((current) => ({ ...current, [project.id]: action }));
    setError(null);

    try {
      if (action === "terminate") {
        await terminateProject(project.id);
        setProjects((current) => current.filter((item) => item.id !== project.id));
        setPendingTerminate(null);
        return;
      }

      const updatedProject =
        action === "start"
          ? await startProject(project.id)
          : await stopProject(project.id);
      setProjects((current) =>
        current.map((item) => (item.id === updatedProject.id ? updatedProject : item))
      );
    } catch (requestError) {
      setError(getApiErrorMessage(requestError));
    } finally {
      setRowLoading((current) => ({ ...current, [project.id]: undefined }));
    }
  }

  async function submitSecurityGroup() {
    const name = securityGroupForm.name.trim();

    if (!name) {
      return;
    }

    setSecurityBusy((current) => ({ ...current, create: true }));
    setError(null);

    try {
      const group = await createSecurityGroup({
        name,
        description: securityGroupForm.description.trim() || undefined
      });
      setSecurityGroups((current) => [group, ...current]);
      setSecurityGroupForm(initialSecurityGroupForm);
      setRuleForms((current) => ({ ...current, [group.id]: initialRuleForm }));
    } catch (requestError) {
      setError(getApiErrorMessage(requestError));
    } finally {
      setSecurityBusy((current) => ({ ...current, create: false }));
    }
  }

  async function removeSecurityGroup(group: SecurityGroupDto) {
    setSecurityBusy((current) => ({ ...current, [group.id]: true }));
    setError(null);

    try {
      await deleteSecurityGroup(group.id);
      setSecurityGroups((current) => current.filter((item) => item.id !== group.id));
      setProjects((current) =>
        current.map((project) => ({
          ...project,
          securityGroups: project.securityGroups.filter((item) => item.id !== group.id)
        }))
      );
    } catch (requestError) {
      setError(getApiErrorMessage(requestError));
    } finally {
      setSecurityBusy((current) => ({ ...current, [group.id]: false }));
    }
  }

  async function submitSecurityGroupEdit(group: SecurityGroupDto) {
    const form = editingGroups[group.id];
    const name = form?.name.trim();

    if (!form || !name) {
      return;
    }

    setSecurityBusy((current) => ({ ...current, [`edit:${group.id}`]: true }));
    setError(null);

    try {
      const updatedGroup = await updateSecurityGroup(group.id, {
        name,
        description: form.description.trim() || undefined
      });
      setSecurityGroups((current) =>
        current.map((item) => (item.id === group.id ? updatedGroup : item))
      );
      setProjects((current) =>
        current.map((project) => ({
          ...project,
          securityGroups: project.securityGroups.map((attachedGroup) =>
            attachedGroup.id === group.id ? updatedGroup : attachedGroup
          )
        }))
      );
      setEditingGroups((current) => ({ ...current, [group.id]: undefined }));
    } catch (requestError) {
      setError(getApiErrorMessage(requestError));
    } finally {
      setSecurityBusy((current) => ({ ...current, [`edit:${group.id}`]: false }));
    }
  }

  function updateRuleForm(groupId: string, patch: Partial<RuleFormState>) {
    setRuleForms((current) => ({
      ...current,
      [groupId]: { ...(current[groupId] ?? initialRuleForm), ...patch }
    }));
  }

  function applyRulePreset(groupId: string, preset: RulePreset) {
    updateRuleForm(groupId, getRulePresetState(preset, clientIp));
  }

  async function submitRule(group: SecurityGroupDto) {
    const form = ruleForms[group.id] ?? initialRuleForm;
    const input = buildRuleRequest(form);

    if (!input) {
      setError("Enter a valid source CIDR and port range.");
      return;
    }

    setSecurityBusy((current) => ({ ...current, [`rule:${group.id}`]: true }));
    setError(null);

    try {
      const updatedGroup = await addSecurityRule(group.id, input);
      setSecurityGroups((current) =>
        current.map((item) =>
          item.id === group.id ? updatedGroup : item
        )
      );
    } catch (requestError) {
      setError(getApiErrorMessage(requestError));
    } finally {
      setSecurityBusy((current) => ({ ...current, [`rule:${group.id}`]: false }));
    }
  }

  async function removeRule(group: SecurityGroupDto, ruleId: string) {
    setSecurityBusy((current) => ({ ...current, [`rule:${ruleId}`]: true }));
    setError(null);

    try {
      const updatedGroup = await deleteSecurityRule(group.id, ruleId);
      setSecurityGroups((current) =>
        current.map((item) =>
          item.id === group.id ? updatedGroup : item
        )
      );
    } catch (requestError) {
      setError(getApiErrorMessage(requestError));
    } finally {
      setSecurityBusy((current) => ({ ...current, [`rule:${ruleId}`]: false }));
    }
  }

  function openAttachModal(project: CloudProjectDto) {
    setAttachProject(project);
    setAttachSelection(project.securityGroups.map((group) => group.id));
  }

  async function saveAttachments() {
    if (!attachProject) {
      return;
    }

    setIsSavingAttachment(true);
    setError(null);

    try {
      const attachedGroups = await replaceProjectSecurityGroups(attachProject.id, {
        securityGroupIds: attachSelection
      });
      setProjects((current) =>
        current.map((project) =>
          project.id === attachProject.id
            ? { ...project, securityGroups: attachedGroups }
            : project
        )
      );
      setAttachProject(null);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError));
    } finally {
      setIsSavingAttachment(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Local cloud console</p>
          <h1>{APP_NAME}</h1>
        </div>
        <div className="topbar-actions">
          <button
            className="icon-button"
            type="button"
            title="Refresh instances"
            aria-label="Refresh instances"
            onClick={() => void refreshProjects()}
            disabled={isRefreshing}
          >
            <RefreshCcw size={18} className={isRefreshing ? "spin" : undefined} />
          </button>
          <button
            className="primary-button"
            type="button"
            onClick={() => setIsLaunchOpen(true)}
          >
            <Plus size={18} />
            Launch instance
          </button>
        </div>
      </header>

      <section className="status-strip" aria-label="Console status">
        <StatusTile label="Total instances" value={projects.length} />
        <StatusTile label="Running" value={runningCount} tone="success" />
        <StatusTile label="Stopped" value={projects.length - runningCount} tone="warn" />
        <StatusTile label="API host" value={getApiBaseUrl().replace(/^https?:\/\//, "")} />
      </section>

      {error ? (
        <div className="alert" role="alert">
          <AlertTriangle size={18} />
          <span>{error}</span>
        </div>
      ) : null}

      <nav className="tabbar" aria-label="Console sections">
        <button
          className={activeTab === "instances" ? "active" : undefined}
          type="button"
          onClick={() => setActiveTab("instances")}
        >
          Instances
        </button>
        <button
          className={activeTab === "security-groups" ? "active" : undefined}
          type="button"
          onClick={() => setActiveTab("security-groups")}
        >
          Security Groups
        </button>
      </nav>

      {activeTab === "instances" ? (
        <section className="table-section" aria-labelledby="instances-title">
          <div className="section-heading">
            <div>
              <p className="section-kicker">Instances</p>
              <h2 id="instances-title">Cloud projects</h2>
            </div>
          </div>

          <div className="table-frame">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Instance type</th>
                  <th>Status</th>
                  <th>IPv4</th>
                  <th>Created</th>
                  <th>Access</th>
                  <th className="actions-column">Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={7}>
                      <div className="empty-state">
                        <Loader2 className="spin" size={18} />
                        Loading instances
                      </div>
                    </td>
                  </tr>
                ) : projects.length === 0 ? (
                  <tr>
                    <td colSpan={7}>
                      <div className="empty-state">No instances found</div>
                    </td>
                  </tr>
                ) : (
                  projects.map((project) => (
                    <InstanceRow
                      key={project.id}
                      project={project}
                      rowAction={rowLoading[project.id]}
                      onStart={() => void runRowAction(project, "start")}
                      onStop={() => void runRowAction(project, "stop")}
                      onConnect={() => setTerminalProject(project)}
                      onMonitor={() => setMonitorProject(project)}
                      onSecurity={() => openAttachModal(project)}
                      onTerminate={() => setPendingTerminate(project)}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <SecurityGroupsTab
          clientIp={clientIp}
          groups={securityGroups}
          groupForm={securityGroupForm}
          isCreating={Boolean(securityBusy.create)}
          ruleForms={ruleForms}
          busy={securityBusy}
          editingGroups={editingGroups}
          onGroupFormChange={setSecurityGroupForm}
          onCreateGroup={() => void submitSecurityGroup()}
          onEditGroup={(group) =>
            setEditingGroups((current) => ({
              ...current,
              [group.id]: {
                name: group.name,
                description: group.description ?? ""
              }
            }))
          }
          onEditGroupChange={(groupId, form) =>
            setEditingGroups((current) => ({ ...current, [groupId]: form }))
          }
          onCancelGroupEdit={(groupId) =>
            setEditingGroups((current) => ({ ...current, [groupId]: undefined }))
          }
          onSaveGroupEdit={(group) => void submitSecurityGroupEdit(group)}
          onDeleteGroup={(group) => void removeSecurityGroup(group)}
          onApplyPreset={applyRulePreset}
          onRuleFormChange={updateRuleForm}
          onAddRule={(group) => void submitRule(group)}
          onDeleteRule={(group, ruleId) => void removeRule(group, ruleId)}
        />
      )}

      {isLaunchOpen && catalog ? (
        <LaunchModal
          catalog={catalog}
          form={launchForm}
          isLaunching={isLaunching}
          onChange={setLaunchForm}
          onClose={() => setIsLaunchOpen(false)}
          onSubmit={() => void submitLaunch()}
        />
      ) : null}

      {pendingTerminate ? (
        <TerminateModal
          project={pendingTerminate}
          isTerminating={rowLoading[pendingTerminate.id] === "terminate"}
          onCancel={() => setPendingTerminate(null)}
          onConfirm={() => void runRowAction(pendingTerminate, "terminate")}
        />
      ) : null}

      {keyDelivery ? (
        <KeyDeliveryModal
          delivery={keyDelivery}
          onClose={() => setKeyDelivery(null)}
          onDownload={() =>
            downloadPrivateKey(
              keyDelivery.privateKeyPem,
              keyDelivery.privateKeyFileName
            )
          }
        />
      ) : null}

      {terminalProject ? (
        <TerminalModal
          project={terminalProject}
          onClose={() => setTerminalProject(null)}
        />
      ) : null}

      {monitorProject ? (
        <MonitorModal
          project={monitorProject}
          onClose={() => setMonitorProject(null)}
        />
      ) : null}

      {attachProject ? (
        <AttachSecurityGroupsModal
          clientIp={clientIp}
          groups={securityGroups}
          project={attachProject}
          selectedIds={attachSelection}
          isSaving={isSavingAttachment}
          onChange={setAttachSelection}
          onClose={() => setAttachProject(null)}
          onSave={() => void saveAttachments()}
        />
      ) : null}
    </main>
  );
}

function StatusTile(props: {
  label: string;
  value: string | number;
  tone?: "success" | "warn";
}) {
  return (
    <div className={`status-tile ${props.tone ?? ""}`}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function InstanceRow(props: {
  project: CloudProjectDto;
  rowAction: RowAction | undefined;
  onStart: () => void;
  onStop: () => void;
  onConnect: () => void;
  onMonitor: () => void;
  onSecurity: () => void;
  onTerminate: () => void;
}) {
  const { project, rowAction } = props;
  const isBusy = Boolean(rowAction);

  return (
    <tr>
      <td>
        <div className="name-cell">
          <strong>{project.name}</strong>
          <code>{project.id}</code>
          <span>{project.instanceName}</span>
          {project.description ? <small>{project.description}</small> : null}
          {project.securityGroups.length > 0 ? (
            <div className="chip-row">
              {project.securityGroups.map((group) => (
                <span className="chip" key={group.id}>
                  {group.name}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </td>
      <td>
        <div className="type-cell">
          <strong>{project.instanceType}</strong>
          <span>
            {project.vcpu} vCPU / {formatMemory(project.memoryMb)}
          </span>
        </div>
      </td>
      <td>
        <StatusBadge status={project.status} />
      </td>
      <td>{project.ipAddress ?? "Pending"}</td>
      <td>{formatDate(project.createdAt)}</td>
      <td>
        {project.hasKey ? (
          <span className="key-badge" title={project.keyFingerprint ?? "Key issued"}>
            <KeyRound size={15} />
            Key issued
          </span>
        ) : (
          <span className="muted">No key</span>
        )}
      </td>
      <td>
        <div className="row-actions">
          <button
            className="icon-button"
            type="button"
            title="Connect"
            aria-label={`Connect to ${project.name}`}
            disabled={isBusy || project.status !== "RUNNING"}
            onClick={props.onConnect}
          >
            <Monitor />
          </button>
          <button
            className="icon-button"
            type="button"
            title="Monitor"
            aria-label={`Monitor ${project.name}`}
            disabled={isBusy || project.status !== "RUNNING"}
            onClick={props.onMonitor}
          >
            <Activity />
          </button>
          <button
            className="icon-button"
            type="button"
            title="Security groups"
            aria-label={`Security groups for ${project.name}`}
            disabled={isBusy}
            onClick={props.onSecurity}
          >
            <Shield />
          </button>
          {project.status === "RUNNING" ? (
            <button
              className="icon-button"
              type="button"
              title="Stop instance"
              aria-label={`Stop ${project.name}`}
              disabled={isBusy}
              onClick={props.onStop}
            >
              {rowAction === "stop" ? <Loader2 className="spin" /> : <Square />}
            </button>
          ) : (
            <button
              className="icon-button"
              type="button"
              title="Start instance"
              aria-label={`Start ${project.name}`}
              disabled={isBusy}
              onClick={props.onStart}
            >
              {rowAction === "start" ? <Loader2 className="spin" /> : <Play />}
            </button>
          )}
          <button
            className="icon-button danger"
            type="button"
            title="Terminate instance"
            aria-label={`Terminate ${project.name}`}
            disabled={isBusy}
            onClick={props.onTerminate}
          >
            {rowAction === "terminate" ? <Loader2 className="spin" /> : <Trash2 />}
          </button>
        </div>
      </td>
    </tr>
  );
}

function SecurityGroupsTab(props: {
  clientIp: string | null;
  groups: SecurityGroupDto[];
  groupForm: SecurityGroupFormState;
  isCreating: boolean;
  ruleForms: Record<string, RuleFormState>;
  busy: Record<string, boolean>;
  editingGroups: Record<string, SecurityGroupFormState | undefined>;
  onGroupFormChange: (form: SecurityGroupFormState) => void;
  onCreateGroup: () => void;
  onEditGroup: (group: SecurityGroupDto) => void;
  onEditGroupChange: (groupId: string, form: SecurityGroupFormState) => void;
  onCancelGroupEdit: (groupId: string) => void;
  onSaveGroupEdit: (group: SecurityGroupDto) => void;
  onDeleteGroup: (group: SecurityGroupDto) => void;
  onApplyPreset: (groupId: string, preset: RulePreset) => void;
  onRuleFormChange: (groupId: string, patch: Partial<RuleFormState>) => void;
  onAddRule: (group: SecurityGroupDto) => void;
  onDeleteRule: (group: SecurityGroupDto, ruleId: string) => void;
}) {
  return (
    <section className="table-section" aria-labelledby="security-groups-title">
      <div className="section-heading">
        <div>
          <p className="section-kicker">Network</p>
          <h2 id="security-groups-title">Security groups</h2>
        </div>
        <span className="source-pill">My IP: {props.clientIp ?? "Detecting"}</span>
      </div>

      <div className="security-create">
        <label>
          <span>Name</span>
          <input
            value={props.groupForm.name}
            onChange={(event) =>
              props.onGroupFormChange({
                ...props.groupForm,
                name: event.target.value
              })
            }
            placeholder="web-access"
          />
        </label>
        <label>
          <span>Description</span>
          <input
            value={props.groupForm.description}
            onChange={(event) =>
              props.onGroupFormChange({
                ...props.groupForm,
                description: event.target.value
              })
            }
            placeholder="Inbound rules for web instances"
          />
        </label>
        <button
          className="primary-button"
          type="button"
          disabled={props.isCreating || props.groupForm.name.trim().length === 0}
          onClick={props.onCreateGroup}
        >
          {props.isCreating ? <Loader2 className="spin" /> : <Plus />}
          Create
        </button>
      </div>

      {props.groups.length === 0 ? (
        <div className="table-frame">
          <div className="empty-state">No security groups found</div>
        </div>
      ) : (
        <div className="security-group-list">
          {props.groups.map((group) => {
            const ruleForm = props.ruleForms[group.id] ?? initialRuleForm;
            const editForm = props.editingGroups[group.id];

            return (
              <article className="security-group-panel" key={group.id}>
                <div className="security-group-header">
                  {editForm ? (
                    <div className="security-edit-form">
                      <input
                        value={editForm.name}
                        onChange={(event) =>
                          props.onEditGroupChange(group.id, {
                            ...editForm,
                            name: event.target.value
                          })
                        }
                        aria-label="Security group name"
                      />
                      <input
                        value={editForm.description}
                        onChange={(event) =>
                          props.onEditGroupChange(group.id, {
                            ...editForm,
                            description: event.target.value
                          })
                        }
                        aria-label="Security group description"
                      />
                    </div>
                  ) : (
                    <div>
                      <h3>{group.name}</h3>
                      <p>{group.description ?? "No description"}</p>
                    </div>
                  )}
                  <div className="row-actions">
                    {editForm ? (
                      <>
                        <button
                          className="icon-button"
                          type="button"
                          title="Save security group"
                          aria-label={`Save ${group.name}`}
                          disabled={
                            Boolean(props.busy[`edit:${group.id}`]) ||
                            editForm.name.trim().length === 0
                          }
                          onClick={() => props.onSaveGroupEdit(group)}
                        >
                          {props.busy[`edit:${group.id}`] ? (
                            <Loader2 className="spin" />
                          ) : (
                            <Check />
                          )}
                        </button>
                        <button
                          className="icon-button"
                          type="button"
                          title="Cancel edit"
                          aria-label="Cancel edit"
                          onClick={() => props.onCancelGroupEdit(group.id)}
                        >
                          <X />
                        </button>
                      </>
                    ) : (
                      <button
                        className="icon-button"
                        type="button"
                        title="Edit security group"
                        aria-label={`Edit ${group.name}`}
                        disabled={Boolean(props.busy[group.id])}
                        onClick={() => props.onEditGroup(group)}
                      >
                        <Pencil />
                      </button>
                    )}
                    <button
                      className="icon-button danger"
                      type="button"
                      title="Delete security group"
                      aria-label={`Delete ${group.name}`}
                      disabled={Boolean(props.busy[group.id])}
                      onClick={() => props.onDeleteGroup(group)}
                    >
                      {props.busy[group.id] ? (
                        <Loader2 className="spin" />
                      ) : (
                        <Trash2 />
                      )}
                    </button>
                  </div>
                </div>

                <div className="rule-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Protocol</th>
                        <th>Ports</th>
                        <th>Source</th>
                        <th className="actions-column">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.rules.length === 0 ? (
                        <tr>
                          <td colSpan={4}>
                            <div className="compact-empty">No inbound rules</div>
                          </td>
                        </tr>
                      ) : (
                        group.rules.map((rule) => (
                          <tr key={rule.id}>
                            <td>{rule.protocol}</td>
                            <td>{formatRulePorts(rule)}</td>
                            <td>{rule.sourceIp}</td>
                            <td>
                              <button
                                className="icon-button danger"
                                type="button"
                                title="Remove rule"
                                aria-label="Remove rule"
                                disabled={Boolean(props.busy[`rule:${rule.id}`])}
                                onClick={() => props.onDeleteRule(group, rule.id)}
                              >
                                {props.busy[`rule:${rule.id}`] ? (
                                  <Loader2 className="spin" />
                                ) : (
                                  <X />
                                )}
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="rule-editor">
                  <select
                    value={ruleForm.preset}
                    onChange={(event) =>
                      props.onApplyPreset(group.id, event.target.value as RulePreset)
                    }
                    aria-label="Rule preset"
                  >
                    <option value="SSH">SSH</option>
                    <option value="HTTP">HTTP</option>
                    <option value="HTTPS">HTTPS</option>
                    <option value="CUSTOM_TCP">Custom TCP</option>
                    <option value="ALL">All traffic</option>
                  </select>
                  <select
                    value={ruleForm.protocol}
                    onChange={(event) =>
                      props.onRuleFormChange(group.id, {
                        protocol: event.target.value as SecurityProtocol,
                        preset:
                          event.target.value === "TCP" ? "CUSTOM_TCP" : ruleForm.preset
                      })
                    }
                    disabled={ruleForm.preset !== "CUSTOM_TCP"}
                    aria-label="Protocol"
                  >
                    <option value="TCP">TCP</option>
                    <option value="UDP">UDP</option>
                    <option value="ICMP">ICMP</option>
                    <option value="ALL">ALL</option>
                  </select>
                  <input
                    value={ruleForm.fromPort}
                    onChange={(event) =>
                      props.onRuleFormChange(group.id, {
                        fromPort: event.target.value,
                        preset: "CUSTOM_TCP"
                      })
                    }
                    disabled={ruleForm.protocol === "ALL"}
                    placeholder="From"
                    inputMode="numeric"
                    aria-label="From port"
                  />
                  <input
                    value={ruleForm.toPort}
                    onChange={(event) =>
                      props.onRuleFormChange(group.id, {
                        toPort: event.target.value,
                        preset: "CUSTOM_TCP"
                      })
                    }
                    disabled={ruleForm.protocol === "ALL"}
                    placeholder="To"
                    inputMode="numeric"
                    aria-label="To port"
                  />
                  <div className="source-control">
                    <input
                      value={ruleForm.sourceIp}
                      onChange={(event) =>
                        props.onRuleFormChange(group.id, {
                          sourceIp: event.target.value
                        })
                      }
                      placeholder="0.0.0.0/0"
                      aria-label="Source CIDR"
                    />
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={!props.clientIp}
                      onClick={() =>
                        props.onRuleFormChange(group.id, {
                          sourceIp: props.clientIp ? `${props.clientIp}/32` : defaultSourceIp
                        })
                      }
                    >
                      My IP
                    </button>
                  </div>
                  <button
                    className="primary-button"
                    type="button"
                    disabled={Boolean(props.busy[`rule:${group.id}`])}
                    onClick={() => props.onAddRule(group)}
                  >
                    {props.busy[`rule:${group.id}`] ? (
                      <Loader2 className="spin" />
                    ) : (
                      <Plus />
                    )}
                    Add rule
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function AttachSecurityGroupsModal(props: {
  clientIp: string | null;
  groups: SecurityGroupDto[];
  project: CloudProjectDto;
  selectedIds: string[];
  isSaving: boolean;
  onChange: (ids: string[]) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const selectedGroups = props.groups.filter((group) =>
    props.selectedIds.includes(group.id)
  );
  const hasLockoutRisk =
    props.selectedIds.length > 0 &&
    props.clientIp !== null &&
    !groupsAllowTcpPortFromIp(selectedGroups, 22, props.clientIp);

  function toggleGroup(groupId: string) {
    props.onChange(
      props.selectedIds.includes(groupId)
        ? props.selectedIds.filter((id) => id !== groupId)
        : [...props.selectedIds, groupId]
    );
  }

  return (
    <Modal title="Attach security groups" onClose={props.onClose}>
      <div className="attach-summary">
        <strong>{props.project.name}</strong>
        <span>
          {props.selectedIds.length === 0
            ? "Unmanaged allow-all"
            : `${props.selectedIds.length} group${
                props.selectedIds.length === 1 ? "" : "s"
              } selected`}
        </span>
      </div>

      {hasLockoutRisk ? (
        <div className="warning-panel">
          <AlertTriangle size={20} />
          <div>
            <strong>Current IP is not allowed on TCP/22</strong>
            <p>Terminal and management requests from {props.clientIp} may be blocked.</p>
          </div>
        </div>
      ) : null}

      <div className="attach-list">
        {props.groups.length === 0 ? (
          <div className="compact-empty">No security groups available</div>
        ) : (
          props.groups.map((group) => (
            <label className="check-row" key={group.id}>
              <input
                type="checkbox"
                checked={props.selectedIds.includes(group.id)}
                onChange={() => toggleGroup(group.id)}
              />
              <span>
                <strong>{group.name}</strong>
                <small>
                  {group.rules.length} inbound rule
                  {group.rules.length === 1 ? "" : "s"}
                </small>
              </span>
            </label>
          ))
        )}
      </div>

      <div className="modal-actions">
        <button className="secondary-button" type="button" onClick={props.onClose}>
          Cancel
        </button>
        <button
          className="primary-button"
          type="button"
          disabled={props.isSaving}
          onClick={props.onSave}
        >
          {props.isSaving ? <Loader2 className="spin" /> : <Shield />}
          Save
        </button>
      </div>
    </Modal>
  );
}

function MonitorModal(props: { project: CloudProjectDto; onClose: () => void }) {
  const [metrics, setMetrics] = useState<ProjectMetricsDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(true);

  useEffect(() => {
    let isActive = true;

    async function poll() {
      try {
        const next = await fetchProjectMetrics(props.project.id);

        if (!isActive) {
          return;
        }

        setError(null);
        setMetrics((current) => [...current.slice(-59), next]);
      } catch (requestError) {
        if (isActive) {
          setError(getApiErrorMessage(requestError));
        }
      }
    }

    void poll();
    const interval = window.setInterval(() => {
      void poll();
    }, 2000);

    return () => {
      isActive = false;
      window.clearInterval(interval);
      setIsPolling(false);
    };
  }, [props.project.id]);

  const latest = metrics.at(-1);
  const chartData = metrics.map((item) => ({
    time: new Date(item.timestamp).toLocaleTimeString([], {
      minute: "2-digit",
      second: "2-digit"
    }),
    cpu: round(item.cpu.utilizationPercent),
    memory: round(item.memory.utilizationPercent),
    networkIn: bytesToKb(item.network.inBytesPerSecond),
    networkOut: bytesToKb(item.network.outBytesPerSecond),
    diskRead: bytesToKb(item.diskIo.readBytesPerSecond),
    diskWrite: bytesToKb(item.diskIo.writeBytesPerSecond)
  }));

  return (
    <div className="monitor-backdrop" role="presentation">
      <section
        className="monitor-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Monitoring for ${props.project.name}`}
      >
        <div className="terminal-header">
          <div>
            <h2>{props.project.name}</h2>
            <p>
              {props.project.instanceName} · {isPolling ? "Polling every 2s" : "Paused"}
            </p>
          </div>
          <button
            className="icon-button"
            type="button"
            title="Close monitor"
            aria-label="Close monitor"
            onClick={props.onClose}
          >
            <X size={18} />
          </button>
        </div>
        {error ? (
          <div className="terminal-error" role="alert">
            {error}
          </div>
        ) : null}
        <div className="monitor-content">
          <div className="metric-grid">
            <MetricTile
              label="CPU"
              value={latest ? `${round(latest.cpu.utilizationPercent)}%` : "Waiting"}
            />
            <MetricTile
              label="Memory"
              value={
                latest
                  ? `${round(latest.memory.utilizationPercent)}% / ${formatBytes(
                      latest.memory.totalBytes
                    )}`
                  : "Waiting"
              }
            />
            <MetricTile
              label="Disk"
              value={
                latest
                  ? `${round(latest.disk.utilizationPercent)}% / ${formatBytes(
                      latest.disk.totalBytes
                    )}`
                  : "Waiting"
              }
            />
            <MetricTile
              label="Network"
              value={
                latest
                  ? `${formatRate(latest.network.inBytesPerSecond)} in`
                  : "Waiting"
              }
            />
          </div>
          <div className="chart-grid">
            <MetricChart
              title="CPU and memory"
              data={chartData}
              lines={[
                { dataKey: "cpu", name: "CPU %", color: "#08736a" },
                { dataKey: "memory", name: "Memory %", color: "#b7791f" }
              ]}
            />
            <MetricChart
              title="Network throughput"
              data={chartData}
              unit="KB/s"
              lines={[
                { dataKey: "networkIn", name: "In", color: "#2563eb" },
                { dataKey: "networkOut", name: "Out", color: "#7c3aed" }
              ]}
            />
            <MetricChart
              title="Disk I/O"
              data={chartData}
              unit="KB/s"
              lines={[
                { dataKey: "diskRead", name: "Read", color: "#059669" },
                { dataKey: "diskWrite", name: "Write", color: "#dc2626" }
              ]}
            />
          </div>
        </div>
      </section>
    </div>
  );
}

function MetricTile(props: { label: string; value: string }) {
  return (
    <div className="metric-tile">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function MetricChart(props: {
  title: string;
  data: Array<Record<string, string | number>>;
  unit?: string;
  lines: Array<{ dataKey: string; name: string; color: string }>;
}) {
  return (
    <div className="chart-panel">
      <h3>{props.title}</h3>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={props.data}>
          <CartesianGrid stroke="#e4eaf1" vertical={false} />
          <XAxis dataKey="time" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} unit={props.unit ?? ""} />
          <Tooltip />
          {props.lines.map((line) => (
            <Line
              key={line.dataKey}
              type="monotone"
              dataKey={line.dataKey}
              name={line.name}
              stroke={line.color}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function TerminalModal(props: { project: CloudProjectDto; onClose: () => void }) {
  const [status, setStatus] = useState("Connecting");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const container = document.querySelector<HTMLDivElement>("#terminal-root");

    if (!container) {
      return undefined;
    }

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily:
        '"JetBrains Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace',
      fontSize: 14,
      theme: {
        background: "#0f1724",
        foreground: "#dce6f2",
        cursor: "#78dcca",
        selectionBackground: "#365a66"
      }
    });
    const fitAddon = new FitAddon();
    const socket = new WebSocket(getTerminalWebSocketUrl(props.project.id));

    terminal.loadAddon(fitAddon);
    terminal.open(container);
    fitAddon.fit();

    function sendResize() {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(
          JSON.stringify({
            type: "resize",
            cols: terminal.cols,
            rows: terminal.rows
          })
        );
      }
    }

    const inputDisposable = terminal.onData((data) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "input", data }));
      }
    });

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      sendResize();
    });
    resizeObserver.observe(container);

    socket.addEventListener("open", () => {
      setStatus("Connected");
      terminal.focus();
      sendResize();
    });

    socket.addEventListener("message", (event) => {
      const message = parseTerminalMessage(event.data);

      if (!message) {
        return;
      }

      if (message.type === "ready") {
        setStatus("Connected");
        return;
      }

      if (message.type === "output") {
        terminal.write(message.data);
        return;
      }

      if (message.type === "error") {
        setError(message.message);
        terminal.writeln(`\r\n${message.message}`);
        return;
      }

      if (message.type === "exit") {
        setStatus("Disconnected");
        terminal.writeln("\r\nSession closed.");
      }
    });

    socket.addEventListener("close", () => {
      setStatus("Disconnected");
    });

    socket.addEventListener("error", () => {
      setError("Terminal connection failed.");
    });

    return () => {
      resizeObserver.disconnect();
      inputDisposable.dispose();
      socket.close();
      terminal.dispose();
    };
  }, [props.project.id]);

  return (
    <div className="terminal-backdrop" role="presentation">
      <section
        className="terminal-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Terminal for ${props.project.name}`}
      >
        <div className="terminal-header">
          <div>
            <h2>{props.project.name}</h2>
            <p>
              {props.project.instanceName} · {status}
            </p>
          </div>
          <button
            className="icon-button"
            type="button"
            title="Close terminal"
            aria-label="Close terminal"
            onClick={props.onClose}
          >
            <X size={18} />
          </button>
        </div>
        {error ? (
          <div className="terminal-error" role="alert">
            {error}
          </div>
        ) : null}
        <div id="terminal-root" className="terminal-root" />
      </section>
    </div>
  );
}

function StatusBadge({ status }: { status: CloudProjectDto["status"] }) {
  return <span className={`status-badge ${status.toLowerCase()}`}>{status}</span>;
}

function LaunchModal(props: {
  catalog: InstanceTypeCatalogResponse;
  form: LaunchFormState;
  isLaunching: boolean;
  onChange: (form: LaunchFormState) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const canSubmit = props.form.name.trim().length > 0 && !props.isLaunching;

  return (
    <Modal title="Launch instance" onClose={props.onClose}>
      <div className="form-grid">
        <label>
          <span>Name</span>
          <input
            autoFocus
            value={props.form.name}
            onChange={(event) =>
              props.onChange({ ...props.form, name: event.target.value })
            }
            placeholder="web-server"
          />
        </label>
        <label>
          <span>Description</span>
          <textarea
            value={props.form.description}
            onChange={(event) =>
              props.onChange({ ...props.form, description: event.target.value })
            }
            rows={3}
            placeholder="Production-like Ubuntu VM"
          />
        </label>
        <label>
          <span>Instance type</span>
          <select
            value={props.form.instanceType}
            onChange={(event) =>
              props.onChange({
                ...props.form,
                instanceType: event.target.value as InstanceTypeId
              })
            }
          >
            {props.catalog.types.map((type) => (
              <option key={type.label} value={type.label}>
                {type.label} - {type.vcpu} vCPU / {type.memoryLabel}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="modal-actions">
        <button className="secondary-button" type="button" onClick={props.onClose}>
          Cancel
        </button>
        <button
          className="primary-button"
          type="button"
          onClick={props.onSubmit}
          disabled={!canSubmit}
        >
          {props.isLaunching ? <Loader2 className="spin" /> : <Plus />}
          Launch
        </button>
      </div>
    </Modal>
  );
}

function TerminateModal(props: {
  project: CloudProjectDto;
  isTerminating: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal title="Terminate instance" onClose={props.onCancel}>
      <div className="warning-panel">
        <AlertTriangle size={20} />
        <div>
          <strong>{props.project.name}</strong>
          <p>This permanently deletes the VM and removes the control-plane record.</p>
        </div>
      </div>
      <div className="modal-actions">
        <button className="secondary-button" type="button" onClick={props.onCancel}>
          Cancel
        </button>
        <button
          className="danger-button"
          type="button"
          onClick={props.onConfirm}
          disabled={props.isTerminating}
        >
          {props.isTerminating ? <Loader2 className="spin" /> : <Trash2 />}
          Terminate
        </button>
      </div>
    </Modal>
  );
}

function KeyDeliveryModal(props: {
  delivery: LaunchProjectResponse;
  onClose: () => void;
  onDownload: () => void;
}) {
  return (
    <Modal title="Private key ready" onClose={props.onClose}>
      <div className="warning-panel success">
        <KeyRound size={20} />
        <div>
          <strong>{props.delivery.privateKeyFileName}</strong>
          <p>
            This private key is shown only for this launch. Store it securely before
            closing this dialog.
          </p>
        </div>
      </div>
      <div className="modal-actions">
        <button className="secondary-button" type="button" onClick={props.onClose}>
          <Check size={18} />
          Done
        </button>
        <button className="primary-button" type="button" onClick={props.onDownload}>
          <Download size={18} />
          Download
        </button>
      </div>
    </Modal>
  );
}

function Modal(props: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal" role="dialog" aria-modal="true" aria-label={props.title}>
        <div className="modal-header">
          <h2>{props.title}</h2>
          <button
            className="icon-button"
            type="button"
            title="Close"
            aria-label="Close"
            onClick={props.onClose}
          >
            <X size={18} />
          </button>
        </div>
        {props.children}
      </section>
    </div>
  );
}

function downloadPrivateKey(privateKeyPem: string, fileName: string) {
  const blob = new Blob([privateKeyPem], {
    type: "application/x-pem-file"
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function parseTerminalMessage(raw: unknown):
  | { type: "ready" }
  | { type: "output"; data: string }
  | { type: "error"; message: string }
  | { type: "exit" }
  | null {
  if (typeof raw !== "string") {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as
      | { type?: unknown; data?: unknown; message?: unknown }
      | null;

    if (!parsed || typeof parsed.type !== "string") {
      return null;
    }

    if (parsed.type === "ready" || parsed.type === "exit") {
      return { type: parsed.type };
    }

    if (parsed.type === "output" && typeof parsed.data === "string") {
      return { type: "output", data: parsed.data };
    }

    if (parsed.type === "error" && typeof parsed.message === "string") {
      return { type: "error", message: parsed.message };
    }
  } catch {
    return null;
  }

  return null;
}

function formatMemory(memoryMb: number) {
  return memoryMb >= 1024 ? `${memoryMb / 1024} GB` : `${memoryMb} MB`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}

function bytesToKb(value: number) {
  return Math.round(value / 102.4) / 10;
}

function formatBytes(value: number) {
  if (value >= 1024 ** 3) {
    return `${round(value / 1024 ** 3)} GB`;
  }

  if (value >= 1024 ** 2) {
    return `${round(value / 1024 ** 2)} MB`;
  }

  return `${value} B`;
}

function formatRate(value: number) {
  return `${bytesToKb(value)} KB/s`;
}

function getRulePresetState(
  preset: RulePreset,
  clientIp: string | null
): RuleFormState {
  const sourceIp = clientIp ? `${clientIp}/32` : defaultSourceIp;

  if (preset === "HTTP") {
    return { preset, protocol: "TCP", fromPort: "80", toPort: "80", sourceIp };
  }

  if (preset === "HTTPS") {
    return { preset, protocol: "TCP", fromPort: "443", toPort: "443", sourceIp };
  }

  if (preset === "CUSTOM_TCP") {
    return { preset, protocol: "TCP", fromPort: "", toPort: "", sourceIp };
  }

  if (preset === "ALL") {
    return { preset, protocol: "ALL", fromPort: "", toPort: "", sourceIp };
  }

  return { preset: "SSH", protocol: "TCP", fromPort: "22", toPort: "22", sourceIp };
}

function buildRuleRequest(form: RuleFormState): CreateSecurityRuleRequest | null {
  const sourceIp = form.sourceIp.trim();

  if (!sourceIp) {
    return null;
  }

  if (form.protocol === "ALL") {
    return {
      direction: "INBOUND",
      protocol: "ALL",
      fromPort: null,
      toPort: null,
      sourceIp
    };
  }

  const fromPort = Number.parseInt(form.fromPort, 10);
  const toPort = Number.parseInt(form.toPort || form.fromPort, 10);

  if (
    !Number.isInteger(fromPort) ||
    !Number.isInteger(toPort) ||
    fromPort < 0 ||
    toPort < fromPort ||
    toPort > 65535
  ) {
    return null;
  }

  return {
    direction: "INBOUND",
    protocol: form.protocol,
    fromPort,
    toPort,
    sourceIp
  };
}

function formatRulePorts(rule: SecurityGroupDto["rules"][number]) {
  if (rule.protocol === "ALL" || rule.fromPort === null || rule.toPort === null) {
    return "All";
  }

  return rule.fromPort === rule.toPort
    ? String(rule.fromPort)
    : `${rule.fromPort}-${rule.toPort}`;
}

function groupsAllowTcpPortFromIp(
  groups: SecurityGroupDto[],
  port: number,
  ipAddress: string
) {
  return groups.some((group) =>
    group.rules.some((rule) => {
      const protocolAllows = rule.protocol === "ALL" || rule.protocol === "TCP";
      const portAllows =
        rule.protocol === "ALL" ||
        rule.fromPort === null ||
        rule.toPort === null ||
        (rule.fromPort <= port && rule.toPort >= port);

      return protocolAllows && portAllows && cidrContainsIp(rule.sourceIp, ipAddress);
    })
  );
}

function cidrContainsIp(cidr: string, ipAddress: string) {
  const [network, prefixText] = cidr.includes("/") ? cidr.split("/") : [cidr, "32"];
  const ipValue = ipv4ToNumber(ipAddress);
  const networkValue = ipv4ToNumber(network);
  const prefix = Number.parseInt(prefixText ?? "32", 10);

  if (
    ipValue === null ||
    networkValue === null ||
    !Number.isInteger(prefix) ||
    prefix < 0 ||
    prefix > 32
  ) {
    return false;
  }

  if (prefix === 0) {
    return true;
  }

  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  return (ipValue & mask) === (networkValue & mask);
}

function ipv4ToNumber(value: string) {
  const parts = value.split(".");

  if (parts.length !== 4) {
    return null;
  }

  return parts.reduce<number | null>((current, part) => {
    if (current === null || !/^\d+$/.test(part)) {
      return null;
    }

    const octet = Number.parseInt(part, 10);

    if (octet < 0 || octet > 255) {
      return null;
    }

    return ((current << 8) + octet) >>> 0;
  }, 0);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
