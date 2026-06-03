export type AssetType = 'pdf' | 'word' | 'slides' | 'markdown' | 'image' | 'data' | 'other'

export type AssetKind = 'file' | 'folder'

export type AssetSummaryKey = 'folders' | 'md' | 'ppt' | 'images' | 'papers' | 'word' | 'data' | 'other'

export type NewAssetFileType = 'md' | 'docx' | 'pptx' | 'xlsx'

export interface NewAssetFileInput {
  fileType: NewAssetFileType
  fileName: string
}

export type ProjectStage =
  | 'idea'
  | 'survey'
  | 'method_design'
  | 'experiment'
  | 'writing'
  | 'revision'
  | 'submitted'
  | 'archived'

export interface Project {
  id: string
  title: string
  description: string
  researchDirection: string
  stage: ProjectStage
  targetVenue: string
  coverPath: string
  workspacePath: string
  tags: string[]
  sortOrder: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface ProjectInput {
  title: string
  description: string
  researchDirection: string
  stage: ProjectStage
  targetVenue: string
  tags: string[]
}

export interface ProjectMetrics {
  assetCount: number
  timelineDays: number
}

export interface Asset {
  id: string
  projectId: string
  title: string
  originalName: string
  fileName: string
  filePath: string
  assetKind: AssetKind
  fileType: AssetType
  mimeType: string
  sizeBytes: number
  category: string
  tags: string[]
  currentVersionId: string
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface AssetVersion {
  id: string
  assetId: string
  label: string
  fileName: string
  filePath: string
  sizeBytes: number
  note: string
  createdAt: string
}

export interface Idea {
  id: string
  projectId: string
  title: string
  content: string
  tags: string[]
  assetId: string | null
  completed: boolean
  createdAt: string
  updatedAt: string
}

export interface ProjectPlanRange {
  id: string
  projectId: string
  title: string
  description: string
  startDate: string
  endDate: string
  color: string
  isDeadline: boolean
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

export interface ProjectPlanRangeInput {
  title: string
  description: string
  startDate: string
  endDate: string
  color: string
  isDeadline: boolean
}

export type TimelineEventType =
  | 'project_created'
  | 'project_deleted'
  | 'asset_imported'
  | 'asset_updated'
  | 'version_saved'
  | 'idea_created'
  | 'idea_updated'
  | 'idea_deleted'
  | 'daily_summary'

export interface TimelineEvent {
  id: string
  projectId: string
  eventType: TimelineEventType
  title: string
  description: string
  assetId: string | null
  ideaId: string | null
  versionId: string | null
  eventDate: string
}

export type TimelineExportFormat = 'docx' | 'xlsx' | 'json'

export interface DailySummary {
  id: string
  projectId: string
  day: string
  summary: string
  updatedAt: string
}

export interface ProjectBundle {
  assets: Asset[]
  versions: AssetVersion[]
  ideas: Idea[]
  planRanges: ProjectPlanRange[]
  events: TimelineEvent[]
  summaries: DailySummary[]
}

export interface WorkspaceSnapshot {
  workspacePath: string
  projects: Project[]
}
