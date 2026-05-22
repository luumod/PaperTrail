import type {
  Asset,
  DailySummary,
  Idea,
  NewAssetFileInput,
  Project,
  ProjectInput,
  ProjectPlanRange,
  ProjectPlanRangeInput,
  ProjectBundle,
  TimelineEvent,
  TimelineExportFormat,
  WorkspaceSnapshot,
} from '@/types'

declare global {
  interface Window {
    paperTimeline?: {
      invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>
    }
  }
}

const invoke = <T>(command: string, args?: Record<string, unknown>) => {
  const electronInvoke = window.paperTimeline?.invoke

  if (!electronInvoke) {
    throw new Error('Electron runtime is not available')
  }

  return electronInvoke<T>(command, args)
}

export const isDesktopRuntime = () => Boolean(window.paperTimeline?.invoke)

export const desktopApi = {
  chooseWorkspace: () => invoke<string | null>('choose_workspace'),
  setWorkspace: (workspacePath: string) =>
    invoke<WorkspaceSnapshot>('set_workspace', { workspacePath }),
  listProjects: () => invoke<Project[]>('list_projects'),
  createProject: (input: ProjectInput) => invoke<Project>('create_project', { input }),
  updateProject: (projectId: string, input: ProjectInput) =>
    invoke<Project>('update_project', { projectId, input }),
  deleteProject: (projectId: string) => invoke<Project>('delete_project', { projectId }),
  setProjectCover: (projectId: string) => invoke<Project>('set_project_cover', { projectId }),
  exportProjectPackage: (projectId: string) => invoke<string>('export_project_package', { projectId }),
  getProjectBundle: (projectId: string) =>
    invoke<ProjectBundle>('get_project_bundle', { projectId }),
  importAssets: (projectId: string) => invoke<Asset[]>('import_assets', { projectId }),
  createAssetFile: (projectId: string, input: NewAssetFileInput) =>
    invoke<ProjectBundle>('create_asset_file', { projectId, input }),
  renameAsset: (assetId: string, title: string) =>
    invoke<ProjectBundle>('rename_asset', { assetId, title }),
  deleteAsset: (assetId: string) => invoke<ProjectBundle>('delete_asset', { assetId }),
  openAsset: (assetId: string) => invoke<void>('open_asset', { assetId }),
  revealAsset: (assetId: string) => invoke<void>('reveal_asset', { assetId }),
  refreshAssetMetadata: (assetId: string) =>
    invoke<ProjectBundle>('refresh_asset_metadata', { assetId }),
  saveAssetVersion: (assetId: string, label: string, note: string) =>
    invoke<ProjectBundle>('save_asset_version', { assetId, label, note }),
  openAssetVersion: (versionId: string) => invoke<void>('open_asset_version', { versionId }),
  createIdea: (
    projectId: string,
    title: string,
    content: string,
    tags: string[],
    assetId: string | null,
  ) => invoke<Idea>('create_idea', { projectId, title, content, tags, assetId }),
  updateIdea: (
    ideaId: string,
    title: string,
    content: string,
    tags: string[],
    assetId: string | null,
    completed: boolean,
  ) => invoke<Idea>('update_idea', { ideaId, title, content, tags, assetId, completed }),
  deleteIdea: (ideaId: string) => invoke<ProjectBundle>('delete_idea', { ideaId }),
  createPlanRange: (projectId: string, input: ProjectPlanRangeInput) =>
    invoke<ProjectBundle>('create_plan_range', { projectId, input }),
  updatePlanRange: (rangeId: string, input: ProjectPlanRangeInput) =>
    invoke<ProjectPlanRange>('update_plan_range', { rangeId, input }),
  deletePlanRange: (rangeId: string) => invoke<ProjectBundle>('delete_plan_range', { rangeId }),
  saveDailySummary: (projectId: string, day: string, summary: string) =>
    invoke<DailySummary>('save_daily_summary', { projectId, day, summary }),
  updateTimelineEvent: (eventId: string, title: string, description: string) =>
    invoke<TimelineEvent>('update_timeline_event', { eventId, title, description }),
  deleteTimelineEvent: (eventId: string) => invoke<ProjectBundle>('delete_timeline_event', { eventId }),
  exportTimeline: (projectId: string, format: TimelineExportFormat) =>
    invoke<string>('export_timeline', { projectId, format }),
}
