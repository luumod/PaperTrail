import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { desktopApi, isDesktopRuntime } from '@/services/desktop'
import type {
  Asset,
  AssetSummaryKey,
  AssetType,
  AssetVersion,
  DailySummary,
  Idea,
  Project,
  ProjectInput,
  ProjectMetrics,
  ProjectPlanRange,
  ProjectPlanRangeInput,
  ProjectStage,
  ProjectBundle,
  TimelineExportFormat,
  TimelineEvent,
  WorkspaceSnapshot,
} from '@/types'

const LOCAL_KEY = 'paper-timeline-workbench'
const WORKSPACE_KEY = 'paper-timeline-workbench.workspace'

interface LocalState extends WorkspaceSnapshot, ProjectBundle {
  activeProjectId: string
}

const nowIso = () => new Date().toISOString()

const makeId = (prefix: string) => {
  const fallback = `${Date.now()}_${Math.random().toString(16).slice(2)}`
  return `${prefix}_${crypto.randomUUID?.() ?? fallback}`
}

const splitTags = (value: string) =>
  value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)

export const projectStageOptions: Array<{ value: ProjectStage; label: string }> = [
  { value: 'idea', label: 'Idea 整理' },
  { value: 'survey', label: '文献调研' },
  { value: 'method_design', label: '方法设计' },
  { value: 'experiment', label: '实验中' },
  { value: 'writing', label: '写作中' },
  { value: 'revision', label: '修改中' },
  { value: 'submitted', label: '已投稿' },
  { value: 'archived', label: '已归档' },
]

export const getProjectStageLabel = (stage: ProjectStage) =>
  projectStageOptions.find((option) => option.value === stage)?.label ?? stage

const normalizeProject = (project: Partial<Project> & Pick<Project, 'id' | 'title'>): Project => ({
  id: project.id,
  title: project.title,
  description: project.description ?? '',
  researchDirection: project.researchDirection ?? project.tags?.join(' / ') ?? '',
  stage: project.stage ?? 'idea',
  targetVenue: project.targetVenue ?? '',
  coverPath: project.coverPath ?? '',
  workspacePath: project.workspacePath ?? 'Browser demo workspace',
  tags: project.tags ?? [],
  createdAt: project.createdAt ?? nowIso(),
  updatedAt: project.updatedAt ?? project.createdAt ?? nowIso(),
})

const normalizeIdea = (
  idea: Partial<Idea> & Pick<Idea, 'id' | 'projectId' | 'title' | 'content'>,
): Idea => ({
  id: idea.id,
  projectId: idea.projectId,
  title: idea.title,
  content: idea.content,
  tags: idea.tags ?? [],
  assetId: idea.assetId ?? null,
  completed: idea.completed ?? false,
  createdAt: idea.createdAt ?? nowIso(),
  updatedAt: idea.updatedAt ?? idea.createdAt ?? nowIso(),
})

const normalizePlanRange = (
  range: Partial<ProjectPlanRange> & Pick<ProjectPlanRange, 'id' | 'projectId' | 'title' | 'startDate' | 'endDate'>,
): ProjectPlanRange => ({
  id: range.id,
  projectId: range.projectId,
  title: range.title,
  description: range.description ?? '',
  startDate: range.startDate,
  endDate: range.endDate,
  color: range.color ?? 'blue',
  isDeadline: range.isDeadline ?? false,
  createdAt: range.createdAt ?? nowIso(),
  updatedAt: range.updatedAt ?? range.createdAt ?? nowIso(),
})

const detectType = (name: string, mimeType = ''): AssetType => {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''

  if (mimeType.includes('pdf') || ext === 'pdf') return 'pdf'
  if (['doc', 'docx'].includes(ext)) return 'word'
  if (['ppt', 'pptx', 'key'].includes(ext)) return 'slides'
  if (['md', 'markdown'].includes(ext)) return 'markdown'
  if (mimeType.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) {
    return 'image'
  }
  if (['csv', 'tsv', 'xlsx', 'xls', 'json'].includes(ext)) return 'data'
  return 'other'
}

const emptyLocalState = (): LocalState => ({
  workspacePath: '',
  projects: [],
  activeProjectId: '',
  assets: [],
  versions: [],
  ideas: [],
  planRanges: [],
  events: [],
  summaries: [],
})

const loadLocalState = (): LocalState => {
  const stored = localStorage.getItem(LOCAL_KEY)

  if (!stored) return emptyLocalState()

  try {
    const parsed = { ...emptyLocalState(), ...(JSON.parse(stored) as Partial<LocalState>) }
    return {
      ...parsed,
      projects: parsed.projects.map((project) => normalizeProject(project)),
      ideas: parsed.ideas.map((idea) => normalizeIdea(idea)),
      planRanges: parsed.planRanges.map((range) => normalizePlanRange(range)),
    }
  } catch {
    localStorage.removeItem(LOCAL_KEY)
    return emptyLocalState()
  }
}

export const useWorkbenchStore = defineStore('workbench', () => {
  const workspacePath = ref('')
  const projects = ref<Project[]>([])
  const activeProjectId = ref('')
  const assets = ref<Asset[]>([])
  const versions = ref<AssetVersion[]>([])
  const ideas = ref<Idea[]>([])
  const planRanges = ref<ProjectPlanRange[]>([])
  const events = ref<TimelineEvent[]>([])
  const summaries = ref<DailySummary[]>([])
  const searchQuery = ref('')
  const selectedAssetId = ref('')
  const selectedAssetTypes = ref<AssetSummaryKey[]>([])
  const loading = ref(false)
  const error = ref('')
  const dataRevision = ref(0)

  const usingDesktop = computed(() => isDesktopRuntime())
  const activeProject = computed(
    () => projects.value.find((project) => project.id === activeProjectId.value) ?? null,
  )
  const selectedAsset = computed(
    () => assets.value.find((asset) => asset.id === selectedAssetId.value) ?? null,
  )

  const filteredAssets = computed(() => {
    const query = searchQuery.value.trim().toLowerCase()
    const typeFilters = new Set(selectedAssetTypes.value)

    return assets.value.filter((asset) =>
      (!query ||
        [asset.title, asset.originalName, asset.fileType, ...asset.tags].some((field) =>
          field.toLowerCase().includes(query),
        )) &&
      (!typeFilters.size || typeFilters.has(assetSummaryKey(asset.fileType))),
    )
  })

  const filteredIdeas = computed(() => {
    const query = searchQuery.value.trim().toLowerCase()
    if (!query) return ideas.value

    return ideas.value.filter((idea) =>
      [idea.title, idea.content, ...idea.tags].some((field) => field.toLowerCase().includes(query)),
    )
  })

  const eventsByDay = computed(() => {
    const grouped = new Map<string, TimelineEvent[]>()

    for (const event of [...events.value].sort((a, b) => b.eventDate.localeCompare(a.eventDate))) {
      const day = event.eventDate.slice(0, 10)
      grouped.set(day, [...(grouped.get(day) ?? []), event])
    }

    return [...grouped.entries()].map(([day, dayEvents]) => ({
      day,
      events: dayEvents,
      summary: summaries.value.find((item) => item.day === day)?.summary ?? '',
    }))
  })

  const assetVersions = computed(() =>
    selectedAssetId.value
      ? versions.value
          .filter((version) => version.assetId === selectedAssetId.value)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      : [],
  )

  const persistLocal = () => {
    if (usingDesktop.value) return

    const local = loadLocalState()
    const activeAssetIds = new Set(assets.value.map((asset) => asset.id))
    const payload: LocalState = {
      workspacePath: workspacePath.value,
      projects: projects.value,
      activeProjectId: activeProjectId.value,
      assets: [
        ...local.assets.filter((asset) => asset.projectId !== activeProjectId.value),
        ...assets.value,
      ],
      versions: [
        ...local.versions.filter((version) => !activeAssetIds.has(version.assetId)),
        ...versions.value,
      ],
      ideas: [
        ...local.ideas.filter((idea) => idea.projectId !== activeProjectId.value),
        ...ideas.value,
      ],
      planRanges: [
        ...local.planRanges.filter((range) => range.projectId !== activeProjectId.value),
        ...planRanges.value,
      ],
      events: [
        ...local.events.filter((event) => event.projectId !== activeProjectId.value),
        ...events.value,
      ],
      summaries: [
        ...local.summaries.filter((summary) => summary.projectId !== activeProjectId.value),
        ...summaries.value,
      ],
    }
    localStorage.setItem(LOCAL_KEY, JSON.stringify(payload))
    dataRevision.value += 1
  }

  const assetSummaryKey = (fileType: AssetType): AssetSummaryKey => {
    if (fileType === 'markdown') return 'md'
    if (fileType === 'slides') return 'ppt'
    if (fileType === 'image') return 'images'
    if (fileType === 'pdf') return 'papers'
    if (fileType === 'word') return 'word'
    if (fileType === 'data') return 'data'
    return 'other'
  }

  const toggleAssetTypeFilter = (type: AssetSummaryKey) => {
    selectedAssetTypes.value = selectedAssetTypes.value.includes(type)
      ? selectedAssetTypes.value.filter((item) => item !== type)
      : [...selectedAssetTypes.value, type]
  }

  const runAction = async <T>(action: () => Promise<T>, fallbackMessage: string) => {
    loading.value = true
    error.value = ''

    try {
      return await action()
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : fallbackMessage
      throw cause
    } finally {
      loading.value = false
    }
  }

  const setBundle = (bundle: ProjectBundle) => {
    assets.value = bundle.assets ?? []
    versions.value = bundle.versions ?? []
    ideas.value = (bundle.ideas ?? []).map((idea) => normalizeIdea(idea))
    planRanges.value = (bundle.planRanges ?? []).map((range) => normalizePlanRange(range))
    events.value = bundle.events ?? []
    summaries.value = bundle.summaries ?? []
    selectedAssetId.value = ''
  }

  const localProjectBundle = (projectId: string): ProjectBundle => {
    const local = loadLocalState()
    const projectAssets = local.assets.filter((asset) => asset.projectId === projectId)

    return {
      assets: projectAssets,
      versions: local.versions.filter((version) =>
        projectAssets.some((asset) => asset.id === version.assetId),
      ),
      ideas: local.ideas.filter((idea) => idea.projectId === projectId),
      planRanges: local.planRanges.filter((range) => range.projectId === projectId),
      events: local.events.filter((event) => event.projectId === projectId),
      summaries: local.summaries.filter((summary) => summary.projectId === projectId),
    }
  }

  const refreshProjectBundle = async (projectId = activeProjectId.value) => {
    if (!projectId) {
      setBundle({ assets: [], versions: [], ideas: [], planRanges: [], events: [], summaries: [] })
      return
    }

    if (usingDesktop.value) {
      setBundle(await desktopApi.getProjectBundle(projectId))
      return
    }

    setBundle(localProjectBundle(projectId))
  }

  const init = async () =>
    runAction(async () => {
      if (usingDesktop.value) {
        const storedWorkspace = localStorage.getItem(WORKSPACE_KEY)

        if (storedWorkspace) {
          const snapshot = await desktopApi.setWorkspace(storedWorkspace)
          workspacePath.value = snapshot.workspacePath
          projects.value = snapshot.projects
          activeProjectId.value = snapshot.projects[0]?.id ?? ''
          await refreshProjectBundle(activeProjectId.value)
        }
        return
      }

      const local = loadLocalState()
      workspacePath.value = local.workspacePath
      projects.value = local.projects
      activeProjectId.value = local.activeProjectId || local.projects[0]?.id || ''
      await refreshProjectBundle(activeProjectId.value)
    }, 'Failed to initialize workbench')

  const chooseWorkspace = async () =>
    runAction(async () => {
      if (!usingDesktop.value) {
        workspacePath.value = 'Browser demo workspace'
        persistLocal()
        return null
      }

      const chosen = await desktopApi.chooseWorkspace()
      if (!chosen) return null

      const snapshot = await desktopApi.setWorkspace(chosen)
      workspacePath.value = snapshot.workspacePath
      projects.value = snapshot.projects
      localStorage.setItem(WORKSPACE_KEY, snapshot.workspacePath)
      activeProjectId.value = snapshot.projects[0]?.id ?? ''
      await refreshProjectBundle(activeProjectId.value)
      return snapshot
    }, 'Failed to choose workspace')

  const createProject = async (input: ProjectInput) =>
    runAction(async () => {
      if (usingDesktop.value) {
        const project = await desktopApi.createProject(input)
        projects.value = [project, ...projects.value]
        activeProjectId.value = project.id
        await refreshProjectBundle(project.id)
        return project
      }

      const timestamp = nowIso()
      const project: Project = {
        id: makeId('project'),
        title: input.title,
        description: input.description,
        researchDirection: input.researchDirection,
        stage: input.stage,
        targetVenue: input.targetVenue,
        coverPath: '',
        workspacePath: workspacePath.value || 'Browser demo workspace',
        tags: input.tags,
        createdAt: timestamp,
        updatedAt: timestamp,
      }

      const event: TimelineEvent = {
        id: makeId('event'),
        projectId: project.id,
        eventType: 'project_created',
        title: `Create project: ${input.title}`,
        description: input.description,
        assetId: null,
        ideaId: null,
        versionId: null,
        eventDate: timestamp,
      }

      workspacePath.value = project.workspacePath
      projects.value = [project, ...projects.value]
      activeProjectId.value = project.id
      assets.value = []
      versions.value = []
      ideas.value = []
      planRanges.value = []
      summaries.value = []
      events.value = [event]
      persistLocal()
      return project
    }, 'Failed to create project')

  const updateProject = async (projectId: string, input: ProjectInput) =>
    runAction(async () => {
      if (usingDesktop.value) {
        const project = await desktopApi.updateProject(projectId, input)
        projects.value = projects.value.map((item) => (item.id === project.id ? project : item))
        return project
      }

      const timestamp = nowIso()
      const updateEvent: TimelineEvent = {
        id: makeId('event'),
        projectId,
        eventType: 'asset_updated',
        title: `Update project: ${input.title}`,
        description: input.description,
        assetId: null,
        ideaId: null,
        versionId: null,
        eventDate: timestamp,
      }
      let updatedProject: Project | null = null
      projects.value = projects.value.map((project) => {
        if (project.id !== projectId) return project

        updatedProject = {
          ...project,
          ...input,
          updatedAt: timestamp,
        }
        return updatedProject
      })

      if (activeProjectId.value === projectId) {
        events.value = [updateEvent, ...events.value]
      } else {
        const local = loadLocalState()
        local.events = [updateEvent, ...local.events]
        localStorage.setItem(LOCAL_KEY, JSON.stringify(local))
      }

      persistLocal()
      return updatedProject
    }, 'Failed to update project')

  const setProjectCover = async (projectId: string, coverPath: string) =>
    runAction(async () => {
      if (usingDesktop.value) {
        const project = await desktopApi.setProjectCover(projectId)
        projects.value = projects.value.map((item) => (item.id === project.id ? project : item))
        return project
      }

      const timestamp = nowIso()
      const coverEvent: TimelineEvent = {
        id: makeId('event'),
        projectId,
        eventType: 'asset_updated',
        title: 'Set project cover',
        description: 'Project cover updated',
        assetId: null,
        ideaId: null,
        versionId: null,
        eventDate: timestamp,
      }
      let updatedProject: Project | null = null
      projects.value = projects.value.map((project) => {
        if (project.id !== projectId) return project

        updatedProject = {
          ...project,
          coverPath,
          updatedAt: timestamp,
        }
        return updatedProject
      })
      if (activeProjectId.value === projectId) {
        events.value = [coverEvent, ...events.value]
      } else {
        const local = loadLocalState()
        local.events = [coverEvent, ...local.events]
        localStorage.setItem(LOCAL_KEY, JSON.stringify(local))
      }
      persistLocal()
      return updatedProject
    }, 'Failed to set project cover')

  const getProjectMetrics = (projectId: string): ProjectMetrics => {
    dataRevision.value

    if (activeProjectId.value === projectId) {
      return {
        assetCount: assets.value.length,
        timelineDays: new Set(events.value.map((event) => event.eventDate.slice(0, 10))).size,
      }
    }

    const local = loadLocalState()
    return {
      assetCount: local.assets.filter((asset) => asset.projectId === projectId).length,
      timelineDays: new Set(
        local.events
          .filter((event) => event.projectId === projectId)
          .map((event) => event.eventDate.slice(0, 10)),
      ).size,
    }
  }

  const exportProjectPackage = async (projectId: string) =>
    runAction(async () => {
      if (usingDesktop.value) {
        return desktopApi.exportProjectPackage(projectId)
      }

      const local = loadLocalState()
      const project = projects.value.find((item) => item.id === projectId)
      if (!project) return ''

      const projectAssets = local.assets.filter((asset) => asset.projectId === projectId)
      const assetIds = new Set(projectAssets.map((asset) => asset.id))
      const packageData = {
        exportedAt: nowIso(),
        project,
        assets: projectAssets,
        versions: local.versions.filter((version) => assetIds.has(version.assetId)),
        ideas: local.ideas.filter((idea) => idea.projectId === projectId),
        planRanges: local.planRanges.filter((range) => range.projectId === projectId),
        events: local.events.filter((event) => event.projectId === projectId),
        summaries: local.summaries.filter((summary) => summary.projectId === projectId),
      }
      const blob = new Blob([JSON.stringify(packageData, null, 2)], {
        type: 'application/json',
      })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${project.title.replace(/[^\w.-]+/g, '_')}_package.json`
      link.click()
      URL.revokeObjectURL(url)
      return link.download
    }, 'Failed to export project package')

  const selectProject = async (projectId: string) =>
    runAction(async () => {
      if (usingDesktop.value) {
        const bundle = await desktopApi.getProjectBundle(projectId)
        activeProjectId.value = projectId
        setBundle(bundle)
      } else {
        activeProjectId.value = projectId
        setBundle(localProjectBundle(projectId))
      }
      persistLocal()
    }, 'Failed to select project')

  const importAssets = async (files?: FileList | null) =>
    runAction(async () => {
      if (!activeProjectId.value) return

      if (usingDesktop.value) {
        const imported = await desktopApi.importAssets(activeProjectId.value)
        if (imported.length) {
          await refreshProjectBundle(activeProjectId.value)
        }
        return
      }

      if (!files?.length) return

      const timestamp = nowIso()
      const newAssets: Asset[] = Array.from(files).map((file) => {
        const assetId = makeId('asset')
        const versionId = makeId('version')
        const asset: Asset = {
          id: assetId,
          projectId: activeProjectId.value,
          title: file.name,
          originalName: file.name,
          fileName: file.name,
          filePath: file.name,
          fileType: detectType(file.name, file.type),
          mimeType: file.type,
          sizeBytes: file.size,
          tags: [],
          currentVersionId: versionId,
          createdAt: timestamp,
          updatedAt: timestamp,
        }

        versions.value = [
          {
            id: versionId,
            assetId,
            label: 'v1',
            fileName: file.name,
            filePath: file.name,
            sizeBytes: file.size,
            note: 'Browser demo mode saves metadata only. Desktop mode copies real files.',
            createdAt: timestamp,
          },
          ...versions.value,
        ]

        return asset
      })

      assets.value = [...newAssets, ...assets.value]
      events.value = [
        ...newAssets.map<TimelineEvent>((asset) => ({
          id: makeId('event'),
          projectId: activeProjectId.value,
          eventType: 'asset_imported',
          title: `Import asset: ${asset.title}`,
          description: asset.filePath,
          assetId: asset.id,
          ideaId: null,
          versionId: asset.currentVersionId,
          eventDate: timestamp,
        })),
        ...events.value,
      ]
      persistLocal()
    }, 'Failed to import assets')

  const deleteAsset = async (assetId: string) =>
    runAction(async () => {
      const asset = assets.value.find((item) => item.id === assetId)
      if (!asset) return

      if (usingDesktop.value) {
        const bundle = await desktopApi.deleteAsset(assetId)
        setBundle(bundle)
        return
      }

      const timestamp = nowIso()
      assets.value = assets.value.filter((item) => item.id !== assetId)
      versions.value = versions.value.filter((version) => version.assetId !== assetId)
      ideas.value = ideas.value.map((idea) => (idea.assetId === assetId ? { ...idea, assetId: null } : idea))
      events.value = [
        {
          id: makeId('event'),
          projectId: asset.projectId,
          eventType: 'asset_updated',
          title: `Delete asset: ${asset.title}`,
          description: asset.filePath,
          assetId: null,
          ideaId: null,
          versionId: null,
          eventDate: timestamp,
        },
        ...events.value,
      ]
      persistLocal()
    }, 'Failed to delete asset')

  const openAsset = async (assetId: string) =>
    runAction(async () => {
      if (usingDesktop.value) {
        await desktopApi.openAsset(assetId)
        return
      }

      alert('Opening local files requires Electron desktop mode.')
    }, 'Failed to open asset')

  const revealAsset = async (assetId: string) =>
    runAction(async () => {
      if (usingDesktop.value) {
        await desktopApi.revealAsset(assetId)
        return
      }

      alert('Revealing local files requires Electron desktop mode.')
    }, 'Failed to reveal asset')

  const refreshAssetMetadata = async (assetId: string) =>
    {
      if (!assetId) return

      try {
        if (usingDesktop.value) {
          const bundle = await desktopApi.refreshAssetMetadata(assetId)
          setBundle(bundle)
          selectedAssetId.value = assetId
          return
        }

        const asset = assets.value.find((item) => item.id === assetId)
        if (asset) {
          asset.updatedAt = nowIso()
          persistLocal()
        }
      } catch (cause) {
        error.value = cause instanceof Error ? cause.message : 'Failed to refresh asset metadata'
        selectedAssetId.value = assetId
      }
    }

  const saveAssetVersion = async (assetId: string, label: string, note: string) =>
    runAction(async () => {
      if (!label.trim() || !note.trim()) {
        throw new Error('Version label and change description are required.')
      }

      if (usingDesktop.value) {
        const bundle = await desktopApi.saveAssetVersion(assetId, label, note)
        setBundle(bundle)
        selectedAssetId.value = assetId
        return
      }

      const asset = assets.value.find((item) => item.id === assetId)
      if (!asset) return

      const timestamp = nowIso()
      const versionId = makeId('version')
      const versionLabel = label || `v${versions.value.filter((item) => item.assetId === assetId).length + 1}`

      versions.value = [
        {
          id: versionId,
          assetId,
          label: versionLabel,
          fileName: asset.fileName,
          filePath: asset.filePath,
          sizeBytes: asset.sizeBytes,
          note,
          createdAt: timestamp,
        },
        ...versions.value,
      ]
      asset.currentVersionId = versionId
      asset.updatedAt = timestamp
      events.value = [
        {
          id: makeId('event'),
          projectId: asset.projectId,
          eventType: 'version_saved',
          title: `Save version: ${asset.title}`,
          description: versionLabel || note,
          assetId,
          ideaId: null,
          versionId,
          eventDate: timestamp,
        },
        ...events.value,
      ]
      persistLocal()
    }, 'Failed to save version')

  const openAssetVersion = async (versionId: string) =>
    runAction(async () => {
      if (usingDesktop.value) {
        await desktopApi.openAssetVersion(versionId)
        return
      }

      const version = versions.value.find((item) => item.id === versionId)
      alert(version ? `Desktop mode can open archived version: ${version.fileName}` : 'Version not found.')
    }, 'Failed to open version')

  const createIdea = async (
    title: string,
    content: string,
    tagsText: string,
    assetId: string | null,
  ) =>
    runAction(async () => {
      if (!activeProjectId.value) return

      const tags = splitTags(tagsText)

      if (usingDesktop.value) {
        const idea = await desktopApi.createIdea(activeProjectId.value, title, content, tags, assetId)
        ideas.value = [idea, ...ideas.value]
        await refreshProjectBundle(activeProjectId.value)
        return
      }

      const timestamp = nowIso()
      const idea: Idea = {
        id: makeId('idea'),
        projectId: activeProjectId.value,
        title,
        content,
        tags,
        assetId,
        completed: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      ideas.value = [idea, ...ideas.value]
      events.value = [
        {
          id: makeId('event'),
          projectId: activeProjectId.value,
          eventType: 'idea_created',
          title: `Record idea: ${title}`,
          description: content,
          assetId,
          ideaId: idea.id,
          versionId: null,
          eventDate: timestamp,
        },
        ...events.value,
      ]
      persistLocal()
    }, 'Failed to create idea')

  const updateIdea = async (
    ideaId: string,
    title: string,
    content: string,
    tagsText: string,
    assetId: string | null,
    completed: boolean,
  ) =>
    runAction(async () => {
      const tags = splitTags(tagsText)

      if (usingDesktop.value) {
        const idea = await desktopApi.updateIdea(ideaId, title, content, tags, assetId, completed)
        ideas.value = ideas.value.map((item) => (item.id === idea.id ? normalizeIdea(idea) : item))
        await refreshProjectBundle(activeProjectId.value)
        return idea
      }

      const existing = ideas.value.find((item) => item.id === ideaId)
      if (!existing) return

      const timestamp = nowIso()
      const updated: Idea = {
        ...existing,
        title,
        content,
        tags,
        assetId,
        completed,
        updatedAt: timestamp,
      }
      ideas.value = ideas.value.map((item) => (item.id === ideaId ? updated : item))
      events.value = [
        {
          id: makeId('event'),
          projectId: existing.projectId,
          eventType: 'idea_updated',
          title: `Update idea: ${title}`,
          description: completed ? 'Marked as completed' : content,
          assetId,
          ideaId,
          versionId: null,
          eventDate: timestamp,
        },
        ...events.value,
      ]
      persistLocal()
      return updated
    }, 'Failed to update idea')

  const deleteIdea = async (ideaId: string) =>
    runAction(async () => {
      const existing = ideas.value.find((item) => item.id === ideaId)
      if (!existing) return

      if (usingDesktop.value) {
        const bundle = await desktopApi.deleteIdea(ideaId)
        setBundle(bundle)
        return
      }

      const timestamp = nowIso()
      ideas.value = ideas.value.filter((item) => item.id !== ideaId)
      events.value = [
        {
          id: makeId('event'),
          projectId: existing.projectId,
          eventType: 'idea_deleted',
          title: `Delete idea: ${existing.title}`,
          description: existing.content,
          assetId: existing.assetId,
          ideaId,
          versionId: null,
          eventDate: timestamp,
        },
        ...events.value,
      ]
      persistLocal()
    }, 'Failed to delete idea')

  const validatePlanRange = (input: ProjectPlanRangeInput) => {
    if (!input.title.trim() || !input.startDate || !input.endDate) {
      throw new Error('Plan title, start date, and end date are required.')
    }

    if (input.startDate > input.endDate) {
      throw new Error('Plan start date cannot be later than end date.')
    }
  }

  const touchProject = (projectId: string, updatedAt: string) => {
    projects.value = projects.value.map((project) =>
      project.id === projectId ? { ...project, updatedAt } : project,
    )
  }

  const createPlanRange = async (input: ProjectPlanRangeInput) =>
    runAction(async () => {
      if (!activeProjectId.value) return
      validatePlanRange(input)

      if (usingDesktop.value) {
        const bundle = await desktopApi.createPlanRange(activeProjectId.value, input)
        setBundle(bundle)
        projects.value = await desktopApi.listProjects()
        return
      }

      const timestamp = nowIso()
      const range: ProjectPlanRange = {
        id: makeId('plan'),
        projectId: activeProjectId.value,
        title: input.title.trim(),
        description: input.description.trim(),
        startDate: input.startDate,
        endDate: input.endDate,
        color: input.color,
        isDeadline: input.isDeadline,
        createdAt: timestamp,
        updatedAt: timestamp,
      }

      planRanges.value = [...planRanges.value, range].sort((a, b) =>
        a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate),
      )
      touchProject(activeProjectId.value, timestamp)
      persistLocal()
      return range
    }, 'Failed to create plan range')

  const updatePlanRange = async (rangeId: string, input: ProjectPlanRangeInput) =>
    runAction(async () => {
      validatePlanRange(input)

      if (usingDesktop.value) {
        const updated = await desktopApi.updatePlanRange(rangeId, input)
        planRanges.value = planRanges.value
          .map((range) => (range.id === updated.id ? normalizePlanRange(updated) : range))
          .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate))
        projects.value = await desktopApi.listProjects()
        return updated
      }

      const existing = planRanges.value.find((range) => range.id === rangeId)
      if (!existing) return

      const timestamp = nowIso()
      const updated: ProjectPlanRange = {
        ...existing,
        title: input.title.trim(),
        description: input.description.trim(),
        startDate: input.startDate,
        endDate: input.endDate,
        color: input.color,
        isDeadline: input.isDeadline,
        updatedAt: timestamp,
      }
      planRanges.value = planRanges.value
        .map((range) => (range.id === rangeId ? updated : range))
        .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate))
      touchProject(existing.projectId, timestamp)
      persistLocal()
      return updated
    }, 'Failed to update plan range')

  const deletePlanRange = async (rangeId: string) =>
    runAction(async () => {
      const existing = planRanges.value.find((range) => range.id === rangeId)
      if (!existing) return

      if (usingDesktop.value) {
        const bundle = await desktopApi.deletePlanRange(rangeId)
        setBundle(bundle)
        projects.value = await desktopApi.listProjects()
        return
      }

      const timestamp = nowIso()
      planRanges.value = planRanges.value.filter((range) => range.id !== rangeId)
      touchProject(existing.projectId, timestamp)
      persistLocal()
    }, 'Failed to delete plan range')

  const saveDailySummary = async (day: string, summary: string) =>
    runAction(async () => {
      if (!activeProjectId.value) return

      if (usingDesktop.value) {
        const saved = await desktopApi.saveDailySummary(activeProjectId.value, day, summary)
        summaries.value = [
          saved,
          ...summaries.value.filter((item) => !(item.projectId === activeProjectId.value && item.day === day)),
        ]
        await refreshProjectBundle(activeProjectId.value)
        return
      }

      const timestamp = nowIso()
      const existing = summaries.value.find(
        (item) => item.projectId === activeProjectId.value && item.day === day,
      )
      const saved: DailySummary = {
        id: existing?.id ?? makeId('summary'),
        projectId: activeProjectId.value,
        day,
        summary,
        updatedAt: timestamp,
      }
      summaries.value = [
        saved,
        ...summaries.value.filter((item) => !(item.projectId === activeProjectId.value && item.day === day)),
      ]
      events.value = [
        {
          id: makeId('event'),
          projectId: activeProjectId.value,
          eventType: 'daily_summary',
          title: `Update daily summary: ${day}`,
          description: summary,
          assetId: null,
          ideaId: null,
          versionId: null,
          eventDate: timestamp,
        },
        ...events.value,
      ]
      persistLocal()
    }, 'Failed to save daily summary')

  const updateTimelineEvent = async (eventId: string, title: string, description: string) =>
    runAction(async () => {
      if (usingDesktop.value) {
        const updated = await desktopApi.updateTimelineEvent(eventId, title, description)
        events.value = events.value.map((event) => (event.id === eventId ? updated : event))
        return updated
      }

      let updatedEvent: TimelineEvent | null = null
      events.value = events.value.map((event) => {
        if (event.id !== eventId) return event
        updatedEvent = { ...event, title, description }
        return updatedEvent
      })
      persistLocal()
      return updatedEvent
    }, 'Failed to update timeline event')

  const deleteTimelineEvent = async (eventId: string) =>
    runAction(async () => {
      if (usingDesktop.value) {
        const bundle = await desktopApi.deleteTimelineEvent(eventId)
        setBundle(bundle)
        return
      }

      events.value = events.value.filter((event) => event.id !== eventId)
      persistLocal()
    }, 'Failed to delete timeline event')

  const exportTimeline = async (format: TimelineExportFormat) =>
    runAction(async () => {
      if (!activeProjectId.value) return ''

      if (usingDesktop.value) {
        return desktopApi.exportTimeline(activeProjectId.value, format)
      }

      const payload = JSON.stringify(
        [...events.value].sort((a, b) => a.eventDate.localeCompare(b.eventDate)),
        null,
        2,
      )
      const blob = new Blob([payload], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${activeProject.value?.title ?? 'timeline'}_timeline.json`
      link.click()
      URL.revokeObjectURL(url)
      return link.download
    }, 'Failed to export timeline')

  return {
    workspacePath,
    projects,
    activeProjectId,
    assets,
    versions,
    ideas,
    planRanges,
    events,
    summaries,
    searchQuery,
    selectedAssetId,
    selectedAssetTypes,
    selectedAsset,
    activeProject,
    filteredAssets,
    filteredIdeas,
    eventsByDay,
    assetVersions,
    loading,
    error,
    usingDesktop,
    init,
    chooseWorkspace,
    createProject,
    updateProject,
    setProjectCover,
    getProjectMetrics,
    exportProjectPackage,
    selectProject,
    toggleAssetTypeFilter,
    importAssets,
    deleteAsset,
    openAsset,
    revealAsset,
    refreshAssetMetadata,
    saveAssetVersion,
    openAssetVersion,
    createIdea,
    updateIdea,
    deleteIdea,
    createPlanRange,
    updatePlanRange,
    deletePlanRange,
    saveDailySummary,
    updateTimelineEvent,
    deleteTimelineEvent,
    exportTimeline,
  }
})
