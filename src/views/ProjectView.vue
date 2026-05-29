<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { getProjectStageLabel, useWorkbenchStore } from '@/stores/workbench'
import type {
  AssetSummaryKey,
  Idea,
  NewAssetFileInput,
  ProjectPlanRange,
  TimelineEvent,
  TimelineExportFormat,
} from '@/types'

const route = useRoute()
const workbench = useWorkbenchStore()
const fileInput = ref<HTMLInputElement | null>(null)

const ideaForm = reactive({
  title: '',
  content: '',
  tags: '',
  assetId: '',
})

const versionForm = reactive({
  label: '',
  note: '',
})

const assetTitleForm = reactive({
  title: '',
  category: '',
})

const createFileForm = reactive<NewAssetFileInput>({
  fileType: 'md',
  fileName: '',
})

const summariesDraft = reactive<Record<string, string>>({})
const isAssetModalOpen = ref(false)
const isCreateFileModalOpen = ref(false)
const isPlanMemoOpen = ref(false)
const assetRefreshTimer = ref<number | null>(null)
const versionError = ref('')
const editingTimelineId = ref('')
const editingIdeaId = ref('')
const editingPlanRangeId = ref('')
const isProjectSwitching = ref(false)
const expandedTimelineDays = ref<string[]>([])

const timelineEditForm = reactive({
  title: '',
  description: '',
})

const planForm = reactive({
  title: '',
  description: '',
  startDate: new Date().toISOString().slice(0, 10),
  endDate: new Date().toISOString().slice(0, 10),
  color: '#2563eb',
  isDeadline: false,
})

const ideaEditForm = reactive({
  title: '',
  content: '',
  tags: '',
  assetId: '',
  completed: false,
})

watch(
  () => route.params.id,
  async (projectId) => {
    if (typeof projectId === 'string' && projectId !== workbench.activeProjectId) {
      isProjectSwitching.value = true
      try {
        await workbench.selectProject(projectId)
      } finally {
        isProjectSwitching.value = false
      }
    }
  },
  { immediate: true },
)

watch(
  () => workbench.eventsByDay,
  (days) => {
    for (const day of days) {
      summariesDraft[day.day] = day.summary
    }
  },
  { immediate: true, deep: true },
)

watch(
  () => workbench.selectedAsset,
  (asset) => {
    assetTitleForm.title = asset?.title ?? ''
    assetTitleForm.category = asset?.category ?? ''
  },
  { immediate: true },
)

const selectedAssetVersions = computed(() => workbench.assetVersions)
const isAssetTitleUnchanged = computed(
  () => assetTitleForm.title.trim() === (workbench.selectedAsset?.title ?? ''),
)
const isAssetCategoryUnchanged = computed(
  () => assetTitleForm.category.trim() === (workbench.selectedAsset?.category ?? ''),
)
const today = computed(() => new Date().toISOString().slice(0, 10))
const createFileTypeOptions: Array<{ value: NewAssetFileInput['fileType']; label: string }> = [
  { value: 'md', label: 'Markdown (.md)' },
  { value: 'docx', label: 'Word (.docx)' },
  { value: 'pptx', label: 'PowerPoint (.pptx)' },
  { value: 'xlsx', label: 'Excel (.xlsx)' },
]
const msPerDay = 24 * 60 * 60 * 1000
const planLabelWidth = 170
const defaultPlanVisibleDays = 60
const minPlanVisibleDays = 7
const maxPlanVisibleDays = 540
const planTimelineRef = ref<HTMLElement | null>(null)
const planTrackRef = ref<HTMLElement | null>(null)
const planViewportStart = ref('')
const planVisibleDays = ref(defaultPlanVisibleDays)
const isPlanTimelineFocused = ref(false)
const isPlanDragging = ref(false)
const planDragStartX = ref(0)
const planDragStartDate = ref('')
const selectedPlanRangeId = ref('')
const defaultPlanColor = '#2563eb'
const planPalette = [
  defaultPlanColor,
  '#059669',
  '#d97706',
  '#e11d48',
  '#7c3aed',
  '#0891b2',
  '#ea580c',
  '#4f46e5',
  '#16a34a',
  '#be123c',
  '#9333ea',
  '#0f766e',
]
const legacyPlanColors: Record<string, string> = {
  blue: '#2563eb',
  green: '#059669',
  amber: '#d97706',
  rose: '#e11d48',
  purple: '#7c3aed',
}

const parseDay = (value: string) => new Date(`${value}T00:00:00`).getTime()
const addDays = (value: string, days: number) => {
  const date = new Date(`${value}T00:00:00`)
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}
const dayDiff = (from: string, to: string) => Math.round((parseDay(to) - parseDay(from)) / msPerDay)
const rangeDuration = (range: ProjectPlanRange) => Math.max(1, dayDiff(range.startDate, range.endDate) + 1)
const resolvePlanColor = (value: string) =>
  /^#[0-9a-f]{6}$/i.test(value) ? value : legacyPlanColors[value] ?? defaultPlanColor
const activePlanRanges = computed(() => workbench.planRanges.filter((range) => !range.archivedAt))
const archivedPlanRanges = computed(() =>
  workbench.planRanges
    .filter((range) => range.archivedAt)
    .sort((a, b) => (b.archivedAt ?? '').localeCompare(a.archivedAt ?? '') || b.endDate.localeCompare(a.endDate)),
)
const nextAutoPlanColor = () => planPalette[activePlanRanges.value.length % planPalette.length] ?? defaultPlanColor
const applyAutoPlanColor = () => {
  planForm.color = nextAutoPlanColor()
}

const sortedPlanRanges = computed(() =>
  [...activePlanRanges.value].sort(
    (a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate),
  ),
)

const planBounds = computed(() => {
  const dates = sortedPlanRanges.value.flatMap((range) => [range.startDate, range.endDate])
  dates.push(today.value)

  const min = dates.reduce((earliest, date) => (date < earliest ? date : earliest), dates[0] ?? today.value)
  const max = dates.reduce((latest, date) => (date > latest ? date : latest), dates[0] ?? today.value)

  return {
    start: addDays(min, sortedPlanRanges.value.length ? -2 : -7),
    end: addDays(max, sortedPlanRanges.value.length ? 4 : 30),
  }
})

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const planViewportStartDate = computed(() => planViewportStart.value || addDays(today.value, -7))
const planViewportEndDate = computed(() => addDays(planViewportStartDate.value, planVisibleDays.value - 1))
const percentForVisibleDate = (date: string) =>
  (dayDiff(planViewportStartDate.value, date) / planVisibleDays.value) * 100
const planTimelineStyle = computed(() => ({
  '--plan-label-width': `${planLabelWidth}px`,
  '--plan-track-width': 'minmax(0, 1fr)',
  '--plan-day-width': `${100 / planVisibleDays.value}%`,
  '--plan-week-width': `${(7 / planVisibleDays.value) * 100}%`,
}))

const planTimelineItems = computed(() =>
  sortedPlanRanges.value
    .map((range) => {
      const startsAfterViewport = range.startDate > planViewportEndDate.value
      const endsBeforeViewport = range.endDate < planViewportStartDate.value
      if (startsAfterViewport || endsBeforeViewport) return null

      const visibleStart = clamp(percentForVisibleDate(range.startDate), 0, 100)
      const visibleEnd = clamp(percentForVisibleDate(addDays(range.endDate, 1)), 0, 100)

      return {
        range,
        left: visibleStart,
        width: Math.max(1.6, visibleEnd - visibleStart),
        duration: rangeDuration(range),
      }
    })
    .filter((item): item is NonNullable<typeof item> => item !== null),
)

const planPlaceholderRows = ['Survey / Design', 'Experiments', 'Writing / Deadline']
const planBarStyle = (item: { left: number; width: number; range: ProjectPlanRange }) => ({
  left: `${item.left}%`,
  width: `${item.width}%`,
  '--plan-bg': resolvePlanColor(item.range.color),
})

const planPopoverStyle = (item: { left: number; width: number; range: ProjectPlanRange }) => ({
  left: `${clamp(item.left + item.width / 2, 12, 88)}%`,
  '--plan-bg': resolvePlanColor(item.range.color),
})

const planTicks = computed(() => {
  const interval =
    planVisibleDays.value <= 21 ? 2 : planVisibleDays.value <= 60 ? 7 : planVisibleDays.value <= 150 ? 14 : 30
  const offsets = new Set<number>()

  for (let offset = 0; offset < planVisibleDays.value; offset += interval) {
    offsets.add(offset)
  }
  offsets.add(planVisibleDays.value - 1)

  return [...offsets].sort((a, b) => a - b).map((offset) => {
    const date = addDays(planViewportStartDate.value, offset)
    return {
      date,
      label: new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      }),
      left: (offset / planVisibleDays.value) * 100,
    }
  })
})

const todayLeft = computed(() => {
  const left = percentForVisibleDate(today.value)
  return left >= 0 && left <= 100 ? left : null
})

const todayLineStyle = computed(() =>
  todayLeft.value === null
    ? {}
    : { left: `calc(var(--plan-label-width) + (100% - var(--plan-label-width)) * ${todayLeft.value / 100})` },
)

const planViewportLabel = computed(
  () => `${planViewportStartDate.value} - ${planViewportEndDate.value}`,
)

const resetPlanViewport = () => {
  planVisibleDays.value = defaultPlanVisibleDays
  planViewportStart.value = sortedPlanRanges.value[0]?.startDate
    ? addDays(sortedPlanRanges.value[0].startDate, -7)
    : addDays(today.value, -7)
  selectedPlanRangeId.value = ''
}

watch(
  () => workbench.activeProjectId,
  () => resetPlanViewport(),
  { immediate: true },
)

const focusPlanWindow = (startDate: string, endDate: string) => {
  const duration = rangeDuration({
    id: '',
    projectId: '',
    title: '',
    description: '',
    startDate,
    endDate,
    color: defaultPlanColor,
    isDeadline: false,
    createdAt: '',
    updatedAt: '',
    archivedAt: null,
  })

  if (duration + 14 > planVisibleDays.value) {
    planVisibleDays.value = clamp(duration + 14, minPlanVisibleDays, maxPlanVisibleDays)
  }

  if (startDate < planViewportStartDate.value || endDate > planViewportEndDate.value) {
    const center = addDays(startDate, Math.floor(dayDiff(startDate, endDate) / 2))
    planViewportStart.value = addDays(center, -Math.floor(planVisibleDays.value / 2))
  }
}

const zoomPlanTimeline = (event: WheelEvent) => {
  if (!isPlanTimelineFocused.value) return

  event.preventDefault()
  const rect = planTrackRef.value?.getBoundingClientRect()
  const pointerRatio = rect ? clamp((event.clientX - rect.left) / rect.width, 0, 1) : 0.5
  const oldDays = planVisibleDays.value
  const focusDate = addDays(planViewportStartDate.value, Math.round(oldDays * pointerRatio))
  const zoomFactor = event.deltaY > 0 ? 1.18 : 0.84
  const nextDays = clamp(Math.round(oldDays * zoomFactor), minPlanVisibleDays, maxPlanVisibleDays)

  planVisibleDays.value = nextDays
  planViewportStart.value = addDays(focusDate, -Math.round(nextDays * pointerRatio))
  selectedPlanRangeId.value = ''
}

const startPlanPan = (event: PointerEvent) => {
  if (event.button !== 0) return
  const target = event.target as HTMLElement
  if (target.closest('button, input, textarea, select, .plan-range-popover')) return

  isPlanTimelineFocused.value = true
  isPlanDragging.value = true
  planDragStartX.value = event.clientX
  planDragStartDate.value = planViewportStartDate.value
  selectedPlanRangeId.value = ''
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

const movePlanPan = (event: PointerEvent) => {
  if (!isPlanDragging.value) return
  const width = planTrackRef.value?.getBoundingClientRect().width ?? 760
  const dayDelta = Math.round(((planDragStartX.value - event.clientX) / width) * planVisibleDays.value)
  planViewportStart.value = addDays(planDragStartDate.value, dayDelta)
}

const stopPlanPan = (event: PointerEvent) => {
  if (!isPlanDragging.value) return
  isPlanDragging.value = false
  if ((event.currentTarget as HTMLElement).hasPointerCapture(event.pointerId)) {
    ;(event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId)
  }
}

const selectPlanRange = (range: ProjectPlanRange) => {
  isPlanTimelineFocused.value = true
  selectedPlanRangeId.value = selectedPlanRangeId.value === range.id ? '' : range.id
}

const blurPlanTimelineIfOutside = (event: MouseEvent) => {
  const target = event.target
  if (!(target instanceof Node)) return
  if (planTimelineRef.value?.contains(target)) return

  isPlanTimelineFocused.value = false
  isPlanDragging.value = false
  selectedPlanRangeId.value = ''
}
const deadlineTarget = computed(() => {
  const deadlineRanges = sortedPlanRanges.value
    .filter((range) => range.isDeadline)
    .sort((a, b) => a.endDate.localeCompare(b.endDate))
  return deadlineRanges.find((range) => range.endDate >= today.value) ?? deadlineRanges.at(-1) ?? null
})

const deadlineStatus = computed(() => {
  const target = deadlineTarget.value
  if (!target) return 'No deadline set'

  const days = dayDiff(today.value, target.endDate)
  if (days > 0) return `${days} days until ${target.title}`
  if (days === 0) return `${target.title} is today`
  return `${Math.abs(days)} days after ${target.title}`
})
const assetStats = computed<Record<AssetSummaryKey, number>>(() => {
  const stats = {
    folders: 0,
    md: 0,
    ppt: 0,
    images: 0,
    papers: 0,
    word: 0,
    data: 0,
    other: 0,
  }

  for (const asset of workbench.assets) {
    if (asset.assetKind === 'folder') stats.folders += 1
    else if (asset.fileType === 'markdown') stats.md += 1
    else if (asset.fileType === 'slides') stats.ppt += 1
    else if (asset.fileType === 'image') stats.images += 1
    else if (asset.fileType === 'pdf') stats.papers += 1
    else if (asset.fileType === 'word') stats.word += 1
    else if (asset.fileType === 'data') stats.data += 1
    else stats.other += 1
  }

  return stats
})

const assetSummaryItems = computed<Array<{ key: AssetSummaryKey; label: string; count: number }>>(() => [
  { key: 'folders', label: 'folders', count: assetStats.value.folders },
  { key: 'md', label: 'md', count: assetStats.value.md },
  { key: 'ppt', label: 'ppt', count: assetStats.value.ppt },
  { key: 'images', label: 'images', count: assetStats.value.images },
  { key: 'papers', label: 'papers', count: assetStats.value.papers },
  { key: 'word', label: 'word', count: assetStats.value.word },
  { key: 'data', label: 'data', count: assetStats.value.data },
  { key: 'other', label: 'other', count: assetStats.value.other },
])

const assetGroups = computed(() => {
  const grouped = new Map<string, typeof workbench.filteredAssets>()

  for (const asset of workbench.filteredAssets) {
    const category = asset.category.trim() || 'Uncategorized'
    grouped.set(category, [...(grouped.get(category) ?? []), asset])
  }

  return [...grouped.entries()].map(([category, assets]) => ({
    category,
    assets,
  }))
})

const timelineEventsSorted = computed(() =>
  [...workbench.events].sort((a, b) => a.eventDate.localeCompare(b.eventDate)),
)

const timelineMonthGroups = computed(() => {
  const months = new Map<
    string,
    {
      month: string
      label: string
      dayMap: Map<string, TimelineEvent[]>
    }
  >()

  for (const event of timelineEventsSorted.value) {
    const day = event.eventDate.slice(0, 10)
    const month = day.slice(0, 7)
    const existing = months.get(month)
    const monthGroup =
      existing ??
      {
        month,
        label: new Date(`${month}-01T00:00:00`).toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'long',
        }),
        dayMap: new Map<string, TimelineEvent[]>(),
      }

    monthGroup.dayMap.set(day, [...(monthGroup.dayMap.get(day) ?? []), event])
    months.set(month, monthGroup)
  }

  return [...months.values()].map((monthGroup) => ({
    month: monthGroup.month,
    label: monthGroup.label,
    eventCount: [...monthGroup.dayMap.values()].reduce((sum, events) => sum + events.length, 0),
    days: [...monthGroup.dayMap.entries()].map(([day, events]) => ({
      day,
      events,
      summary: summariesDraft[day] ?? '',
    })),
  }))
})

watch(
  () => workbench.activeProjectId,
  () => {
    expandedTimelineDays.value = [today.value]
  },
  { immediate: true },
)

watch(
  () => timelineEventsSorted.value.map((event) => event.id).join('|'),
  () => {
    const eventDays = timelineEventsSorted.value.map((event) => event.eventDate.slice(0, 10))
    if (!eventDays.length) {
      expandedTimelineDays.value = [today.value]
      return
    }

    if (eventDays.includes(today.value) && !expandedTimelineDays.value.includes(today.value)) {
      expandedTimelineDays.value = [...expandedTimelineDays.value, today.value]
      return
    }

    if (!expandedTimelineDays.value.some((day) => eventDays.includes(day))) {
      expandedTimelineDays.value = [eventDays.at(-1) ?? today.value]
    }
  },
  { immediate: true },
)

const isTimelineDayExpanded = (day: string) => expandedTimelineDays.value.includes(day)
const toggleTimelineDay = (day: string) => {
  expandedTimelineDays.value = isTimelineDayExpanded(day)
    ? expandedTimelineDays.value.filter((item) => item !== day)
    : [...expandedTimelineDays.value, day]
}

const ideaCards = computed(() =>
  workbench.filteredIdeas.map((idea) => ({
    idea,
    linkedAsset: idea.assetId
      ? workbench.assets.find((asset) => asset.id === idea.assetId)?.title ?? 'Missing asset'
      : '',
  })),
)

const chooseImport = async () => {
  if (workbench.usingDesktop) {
    await workbench.importAssets()
    return
  }

  fileInput.value?.click()
}

const chooseFolderImport = async () => {
  await workbench.importAssetFolder()
}

const openCreateFileModal = () => {
  createFileForm.fileType = 'md'
  createFileForm.fileName = ''
  isCreateFileModalOpen.value = true
}

const closeCreateFileModal = () => {
  isCreateFileModalOpen.value = false
  createFileForm.fileName = ''
}

const createAssetFile = async () => {
  if (!createFileForm.fileName.trim()) {
    workbench.error = 'File name is required.'
    return
  }

  await workbench.createAssetFile({
    fileType: createFileForm.fileType,
    fileName: createFileForm.fileName.trim(),
  })
  closeCreateFileModal()
}

const importBrowserFiles = async (event: Event) => {
  const input = event.target as HTMLInputElement
  await workbench.importAssets(input.files)
  input.value = ''
}

const refreshOpenAsset = async () => {
  if (!isAssetModalOpen.value || !workbench.selectedAssetId) return
  await workbench.refreshAssetMetadata(workbench.selectedAssetId)
}

const stopAssetRefresh = () => {
  if (assetRefreshTimer.value !== null) {
    window.clearInterval(assetRefreshTimer.value)
    assetRefreshTimer.value = null
  }
}

const openAssetDetail = async (assetId: string) => {
  stopAssetRefresh()
  workbench.selectedAssetId = assetId
  isAssetModalOpen.value = true
  await refreshOpenAsset()
  assetRefreshTimer.value = window.setInterval(refreshOpenAsset, 2000)
}

const closeAssetDetail = () => {
  stopAssetRefresh()
  isAssetModalOpen.value = false
  workbench.selectedAssetId = ''
  assetTitleForm.title = ''
  assetTitleForm.category = ''
}

onMounted(() => {
  window.addEventListener('click', blurPlanTimelineIfOutside, true)
})

onBeforeUnmount(() => {
  stopAssetRefresh()
  window.removeEventListener('click', blurPlanTimelineIfOutside, true)
})

const resetPlanForm = () => {
  editingPlanRangeId.value = ''
  selectedPlanRangeId.value = ''
  planForm.title = ''
  planForm.description = ''
  planForm.startDate = today.value
  planForm.endDate = today.value
  planForm.color = nextAutoPlanColor()
  planForm.isDeadline = false
}

const startEditPlanRange = (range: ProjectPlanRange) => {
  selectedPlanRangeId.value = ''
  editingPlanRangeId.value = range.id
  planForm.title = range.title
  planForm.description = range.description
  planForm.startDate = range.startDate
  planForm.endDate = range.endDate
  planForm.color = resolvePlanColor(range.color)
  planForm.isDeadline = range.isDeadline
}

const savePlanRange = async () => {
  const input = {
    title: planForm.title.trim(),
    description: planForm.description.trim(),
    startDate: planForm.startDate,
    endDate: planForm.endDate,
    color: planForm.color,
    isDeadline: planForm.isDeadline,
  }

  if (editingPlanRangeId.value) {
    await workbench.updatePlanRange(editingPlanRangeId.value, input)
  } else {
    await workbench.createPlanRange(input)
  }

  focusPlanWindow(input.startDate, input.endDate)
  resetPlanForm()
}

const deletePlanRange = async (range: ProjectPlanRange) => {
  if (!confirm(`Delete plan range "${range.title}"?`)) return
  if (editingPlanRangeId.value === range.id) {
    resetPlanForm()
  }
  selectedPlanRangeId.value = ''
  await workbench.deletePlanRange(range.id)
}

const addIdea = async () => {
  if (!ideaForm.title.trim() || !ideaForm.content.trim()) {
    workbench.error = 'Idea title and content are required.'
    return
  }

  await workbench.createIdea(
    ideaForm.title.trim(),
    ideaForm.content.trim(),
    ideaForm.tags,
    ideaForm.assetId || null,
  )

  ideaForm.title = ''
  ideaForm.content = ''
  ideaForm.tags = ''
  ideaForm.assetId = ''
}

const startEditIdea = (idea: Idea) => {
  editingIdeaId.value = idea.id
  ideaEditForm.title = idea.title
  ideaEditForm.content = idea.content
  ideaEditForm.tags = idea.tags.join(', ')
  ideaEditForm.assetId = idea.assetId ?? ''
  ideaEditForm.completed = idea.completed
}

const cancelEditIdea = () => {
  editingIdeaId.value = ''
  ideaEditForm.title = ''
  ideaEditForm.content = ''
  ideaEditForm.tags = ''
  ideaEditForm.assetId = ''
  ideaEditForm.completed = false
}

const saveIdeaEdit = async () => {
  if (!editingIdeaId.value) return
  if (!ideaEditForm.title.trim() || !ideaEditForm.content.trim()) {
    workbench.error = 'Idea title and content are required.'
    return
  }

  await workbench.updateIdea(
    editingIdeaId.value,
    ideaEditForm.title.trim(),
    ideaEditForm.content.trim(),
    ideaEditForm.tags,
    ideaEditForm.assetId || null,
    ideaEditForm.completed,
  )
  cancelEditIdea()
}

const toggleIdeaCompleted = async (idea: Idea, event: Event) => {
  const input = event.target as HTMLInputElement
  await workbench.updateIdea(
    idea.id,
    idea.title,
    idea.content,
    idea.tags.join(', '),
    idea.assetId,
    input.checked,
  )
}

const deleteIdea = async (idea: Idea) => {
  if (!confirm(`Delete idea "${idea.title}"?`)) return
  if (editingIdeaId.value === idea.id) {
    cancelEditIdea()
  }
  await workbench.deleteIdea(idea.id)
}

const saveVersion = async () => {
  if (!workbench.selectedAsset) return
  if (!versionForm.label.trim() || !versionForm.note.trim()) {
    versionError.value = 'Please enter both version label and change description before saving.'
    return
  }
  versionError.value = ''

  await workbench.saveAssetVersion(
    workbench.selectedAsset.id,
    versionForm.label.trim(),
    versionForm.note.trim(),
  )

  versionForm.label = ''
  versionForm.note = ''
}

const saveSummary = async (day: string) => {
  await workbench.saveDailySummary(day, summariesDraft[day] ?? '')
}

const deleteAsset = async (assetId: string, title: string) => {
  if (!confirm(`Delete asset "${title}" and all archived versions?`)) return

  if (workbench.selectedAssetId === assetId) {
    closeAssetDetail()
  }
  await workbench.deleteAsset(assetId)
}

const saveAssetTitle = async () => {
  if (!workbench.selectedAsset) return

  const nextTitle = assetTitleForm.title.trim()
  const nextCategory = assetTitleForm.category.trim()
  if (!nextTitle) {
    workbench.error = 'Asset title is required.'
    return
  }

  if (nextTitle !== workbench.selectedAsset.title) {
    await workbench.renameAsset(workbench.selectedAsset.id, nextTitle)
  }
  if (nextCategory !== (workbench.selectedAsset?.category ?? '')) {
    await workbench.updateAssetCategory(workbench.selectedAsset.id, nextCategory)
  }
  assetTitleForm.title = nextTitle
  assetTitleForm.category = nextCategory
}

const startEditTimeline = (event: TimelineEvent) => {
  editingTimelineId.value = event.id
  timelineEditForm.title = event.title
  timelineEditForm.description = event.description
}

const cancelEditTimeline = () => {
  editingTimelineId.value = ''
  timelineEditForm.title = ''
  timelineEditForm.description = ''
}

const saveTimelineEdit = async () => {
  if (!editingTimelineId.value || !timelineEditForm.title.trim()) return

  await workbench.updateTimelineEvent(
    editingTimelineId.value,
    timelineEditForm.title.trim(),
    timelineEditForm.description.trim(),
  )
  cancelEditTimeline()
}

const deleteTimelineEvent = async (eventId: string) => {
  if (!confirm('Delete this timeline event?')) return
  await workbench.deleteTimelineEvent(eventId)
}

const exportTimeline = async (format: TimelineExportFormat) => {
  await workbench.exportTimeline(format)
}
</script>

<template>
  <section
    v-if="workbench.activeProject"
    class="project-page"
    :class="{ 'is-project-switching': isProjectSwitching }"
  >
    <header class="project-header">
      <div>
        <p class="eyebrow">Project</p>
        <h1>{{ workbench.activeProject.title }}</h1>
        <p>{{ workbench.activeProject.description || 'No project description yet.' }}</p>
        <div class="project-header-meta">
          <span>{{ workbench.activeProject.researchDirection || 'Research direction not set' }}</span>
          <span>{{ getProjectStageLabel(workbench.activeProject.stage) }}</span>
          <span>{{ workbench.activeProject.targetVenue || 'Target venue not set' }}</span>
        </div>
      </div>
      <div class="header-actions">
        <input
          v-model="workbench.searchQuery"
          type="search"
          aria-label="Search project"
          placeholder="Search title, tag, type, or idea"
        />
        <button type="button" class="primary-button" :disabled="workbench.loading" @click="chooseImport">
          Import Files
        </button>
        <button type="button" class="primary-button" :disabled="workbench.loading" @click="chooseFolderImport">
          Import Folder
        </button>
        <button type="button" class="primary-button" :disabled="workbench.loading" @click="openCreateFileModal">
          New File
        </button>
        <input ref="fileInput" class="visually-hidden" type="file" multiple @change="importBrowserFiles" />
      </div>
    </header>

    <section class="panel project-plan-panel">
      <div class="panel-heading plan-heading">
        <div>
          <h2>Project Plan Timeline</h2>
          <span>{{ deadlineStatus }}</span>
        </div>
        <div class="plan-heading-actions">
          <button type="button" @click="isPlanMemoOpen = true">
            Memo: {{ archivedPlanRanges.length }}
          </button>
          <span>{{ planViewportLabel }} | {{ sortedPlanRanges.length }} active ranges</span>
        </div>
      </div>

      <form class="plan-form" @submit.prevent="savePlanRange">
        <input v-model="planForm.title" type="text" placeholder="Milestone or task title" />
        <input v-model="planForm.startDate" type="date" />
        <input v-model="planForm.endDate" type="date" />
        <div class="plan-color-picker">
          <input v-model="planForm.color" type="color" title="Plan color" />
          <button type="button" @click="applyAutoPlanColor">Auto</button>
        </div>
        <input
          v-model="planForm.description"
          class="plan-description-input"
          type="text"
          placeholder="Short description: experiment window, writing sprint, rebuttal, deadline..."
        />
        <div class="plan-palette" aria-label="Plan color palette">
          <button
            v-for="color in planPalette"
            :key="color"
            type="button"
            class="plan-swatch"
            :class="{ active: resolvePlanColor(planForm.color) === color }"
            :style="{ backgroundColor: color }"
            :title="color"
            @click="planForm.color = color"
          />
        </div>
        <label class="plan-deadline-check">
          <input v-model="planForm.isDeadline" type="checkbox" />
          Deadline
        </label>
        <button type="submit" class="primary-button" :disabled="workbench.loading">
          {{ editingPlanRangeId ? 'Save Range' : 'Add Range' }}
        </button>
        <button v-if="editingPlanRangeId" type="button" @click="resetPlanForm">Cancel</button>
      </form>

      <div
        ref="planTimelineRef"
        class="plan-timeline-wrap"
        :class="{
          empty: !sortedPlanRanges.length,
          dragging: isPlanDragging,
          focused: isPlanTimelineFocused,
          'has-selected-range': !!selectedPlanRangeId,
        }"
        @wheel="zoomPlanTimeline"
        @pointerdown="startPlanPan"
        @pointermove="movePlanPan"
        @pointerup="stopPlanPan"
        @pointerleave="stopPlanPan"
        @pointercancel="stopPlanPan"
      >
        <div class="plan-timeline-inner" :style="planTimelineStyle">
          <div class="plan-timeline-axis">
            <div class="plan-axis-spacer">Calendar</div>
            <div ref="planTrackRef" class="plan-axis-track">
              <span
                v-for="tick in planTicks"
                :key="tick.date"
                :style="{ left: `${tick.left}%` }"
              >
                {{ tick.label }}
              </span>
            </div>
        </div>
        <div class="plan-timeline-canvas">
          <div v-if="todayLeft !== null" class="plan-today-line" :style="todayLineStyle">
            <span>Today</span>
          </div>
          <article v-if="!planTimelineItems.length" class="plan-empty-message">
            <strong>{{ sortedPlanRanges.length ? 'No ranges in this view' : 'No active plan ranges' }}</strong>
            <span>{{ sortedPlanRanges.length ? 'Current window has no scheduled ranges.' : 'Add a range above; expired ranges move into Memo automatically.' }}</span>
          </article>
          <template v-if="!planTimelineItems.length">
            <article
              v-for="label in planPlaceholderRows"
              :key="label"
              class="plan-row plan-placeholder-row"
            >
              <div class="plan-row-label">
                <strong>{{ label }}</strong>
                <small>Waiting for plan</small>
              </div>
              <div class="plan-track" />
            </article>
          </template>
          <article v-for="item in planTimelineItems" :key="item.range.id" class="plan-row">
            <div class="plan-row-label">
              <strong :title="item.range.title">{{ item.range.title }}</strong>
              <small>
                {{ item.range.startDate }} - {{ item.range.endDate }} | {{ item.duration }} days
              </small>
            </div>
            <div class="plan-track">
              <button
                type="button"
                class="plan-bar"
                :class="{ deadline: item.range.isDeadline }"
                :style="planBarStyle(item)"
                :title="item.range.description || item.range.title"
                @pointerdown.stop
                @click.stop="selectPlanRange(item.range)"
              >
                <strong>{{ item.range.title }}</strong>
                <span>{{ item.duration }}d</span>
              </button>
              <div
                v-if="selectedPlanRangeId === item.range.id"
                class="plan-range-popover"
                :style="planPopoverStyle(item)"
                @pointerdown.stop
                @click.stop
              >
                <strong>{{ item.range.title }}</strong>
                <small>{{ item.range.startDate }} - {{ item.range.endDate }}</small>
                <p>{{ item.range.description || 'No description.' }}</p>
                <div class="button-row">
                  <button type="button" @click="startEditPlanRange(item.range)">Modify</button>
                  <button type="button" class="danger-button" @click="deletePlanRange(item.range)">Delete</button>
                </div>
              </div>
            </div>
          </article>
          </div>
        </div>
      </div>
    </section>

    <div class="workbench-grid">
      <section class="panel asset-library">
        <div class="panel-heading">
          <h2>Asset Library</h2>
          <span>{{ workbench.filteredAssets.length }} files</span>
        </div>

        <div class="asset-summary" aria-label="Asset summary">
          <button
            v-for="item in assetSummaryItems"
            :key="item.key"
            type="button"
            :class="{ active: workbench.selectedAssetTypes.includes(item.key) }"
            @click="workbench.toggleAssetTypeFilter(item.key)"
          >
            {{ item.label }}: {{ item.count }}
          </button>
        </div>

        <div v-if="workbench.filteredAssets.length" class="asset-list">
          <section v-for="group in assetGroups" :key="group.category" class="asset-group">
            <header class="asset-group-heading">
              <strong>{{ group.category }}</strong>
              <span>{{ group.assets.length }} {{ group.assets.length === 1 ? 'asset' : 'assets' }}</span>
            </header>
            <article
              v-for="asset in group.assets"
              :key="asset.id"
              class="asset-row"
              :class="{ active: asset.id === workbench.selectedAssetId }"
            >
              <button type="button" class="asset-main" @click="openAssetDetail(asset.id)">
                <span class="file-type">{{ asset.assetKind === 'folder' ? 'folder' : asset.fileType }}</span>
                <strong>{{ asset.title }}</strong>
                <small>{{ asset.originalName }}</small>
                <span class="tag-row">
                  <em v-if="asset.category">{{ asset.category }}</em>
                  <em v-for="tag in asset.tags" :key="tag">{{ tag }}</em>
                </span>
              </button>
              <button
                type="button"
                class="danger-button asset-delete-button"
                title="Delete asset"
                @click="deleteAsset(asset.id, asset.title)"
              >
                Delete
              </button>
            </article>
          </section>
        </div>

        <p v-else class="empty-copy">
          No assets yet. Import PDFs, Word files, slides, images, Markdown, or datasets to start the library.
        </p>
      </section>

      <section class="panel idea-panel">
        <div class="panel-heading">
          <h2>Ideas</h2>
          <span>{{ workbench.filteredIdeas.length }} notes</span>
        </div>

        <form class="idea-form" @submit.prevent="addIdea">
          <input v-model="ideaForm.title" type="text" placeholder="idea title" />
          <textarea v-model="ideaForm.content" rows="4" placeholder="Record observations, risks, TODOs, or fragments" />
          <div class="form-row">
            <input v-model="ideaForm.tags" type="text" placeholder="tags: ablation, writing" />
            <select v-model="ideaForm.assetId">
              <option value="">No linked asset</option>
              <option v-for="asset in workbench.assets" :key="asset.id" :value="asset.id">
                {{ asset.title }}
              </option>
            </select>
          </div>
          <button type="submit" :disabled="workbench.loading">Add Idea</button>
        </form>

        <div v-if="ideaCards.length" class="idea-list">
          <article
            v-for="{ idea, linkedAsset } in ideaCards"
            :key="idea.id"
            class="idea-card"
            :class="{ completed: idea.completed }"
          >
            <div class="idea-card-header">
              <div class="idea-title-block">
                <label class="idea-check">
                  <input
                    type="checkbox"
                    :checked="idea.completed"
                    :disabled="workbench.loading"
                    @change="toggleIdeaCompleted(idea, $event)"
                  />
                  <span>{{ idea.completed ? 'Done' : 'Open' }}</span>
                </label>
                <strong>{{ idea.title }}</strong>
              </div>
              <time>{{ new Date(idea.updatedAt).toLocaleDateString() }}</time>
            </div>
            <form v-if="editingIdeaId === idea.id" class="idea-edit-form" @submit.prevent="saveIdeaEdit">
              <input v-model="ideaEditForm.title" type="text" placeholder="idea title" />
              <textarea v-model="ideaEditForm.content" rows="4" placeholder="idea content" />
              <div class="form-row">
                <input v-model="ideaEditForm.tags" type="text" placeholder="tags: ablation, writing" />
                <select v-model="ideaEditForm.assetId">
                  <option value="">No linked asset</option>
                  <option v-for="asset in workbench.assets" :key="asset.id" :value="asset.id">
                    {{ asset.title }}
                  </option>
                </select>
              </div>
              <label class="idea-edit-check">
                <input v-model="ideaEditForm.completed" type="checkbox" />
                Completed
              </label>
              <div class="button-row">
                <button type="submit" class="primary-button" :disabled="workbench.loading">Save</button>
                <button type="button" @click="cancelEditIdea">Cancel</button>
              </div>
            </form>
            <template v-else>
              <p>{{ idea.content }}</p>
              <div class="idea-card-footer">
                <button
                  v-if="idea.assetId"
                  type="button"
                  class="linked-asset"
                  @click="openAssetDetail(idea.assetId)"
                >
                  {{ linkedAsset }}
                </button>
                <span v-else class="linked-asset muted">No linked asset</span>
                <span class="tag-row">
                  <em v-for="tag in idea.tags" :key="tag">{{ tag }}</em>
                </span>
              </div>
              <div class="idea-actions">
                <button type="button" @click="startEditIdea(idea)">Modify</button>
                <button type="button" class="danger-button" @click="deleteIdea(idea)">Delete</button>
              </div>
            </template>
          </article>
        </div>
        <p v-else class="empty-copy">No ideas yet. Add concise notes and link them to related assets when useful.</p>
      </section>

      <section class="panel timeline-panel">
        <div class="panel-heading">
          <h2>Timeline</h2>
          <div class="timeline-actions">
            <span>{{ today }}</span>
            <button type="button" @click="exportTimeline('docx')">Export DOCX</button>
            <button type="button" @click="exportTimeline('xlsx')">Export Excel</button>
            <button type="button" @click="exportTimeline('json')">Export JSON</button>
          </div>
        </div>

        <div v-if="timelineMonthGroups.length" class="timeline-month-list">
          <section v-for="month in timelineMonthGroups" :key="month.month" class="timeline-month">
            <header class="timeline-month-header">
              <h3>{{ month.label }}</h3>
              <span>{{ month.days.length }} days | {{ month.eventCount }} events</span>
            </header>

            <article
              v-for="day in month.days"
              :key="day.day"
              class="day-group"
              :class="{ collapsed: !isTimelineDayExpanded(day.day) }"
            >
              <button type="button" class="day-toggle" @click="toggleTimelineDay(day.day)">
                <span>{{ isTimelineDayExpanded(day.day) ? '-' : '+' }}</span>
                <strong>{{ day.day }}</strong>
                <em>{{ day.events.length }} events</em>
              </button>

              <div v-if="isTimelineDayExpanded(day.day)" class="day-detail">
                <div class="day-header">
                  <h3>{{ day.day }}</h3>
                  <button type="button" :disabled="workbench.loading" @click="saveSummary(day.day)">
                    Save Summary
                  </button>
                </div>
                <textarea
                  v-model="summariesDraft[day.day]"
                  rows="2"
                  placeholder="What happened today? Risks? Next step?"
                />
                <ol>
                  <li v-for="event in day.events" :key="event.id">
                    <span>{{ new Date(event.eventDate).toLocaleTimeString() }}</span>
                    <template v-if="editingTimelineId === event.id">
                      <form class="timeline-edit-form" @submit.prevent="saveTimelineEdit">
                        <input v-model="timelineEditForm.title" type="text" placeholder="Timeline title" />
                        <textarea v-model="timelineEditForm.description" rows="2" placeholder="Timeline description" />
                        <div class="button-row">
                          <button type="submit" class="primary-button">Save</button>
                          <button type="button" @click="cancelEditTimeline">Cancel</button>
                        </div>
                      </form>
                    </template>
                    <template v-else>
                      <div class="timeline-event-content">
                        <strong>{{ event.title }}</strong>
                        <p>{{ event.description }}</p>
                      </div>
                      <div class="timeline-event-actions">
                        <button type="button" @click="startEditTimeline(event)">Modify</button>
                        <button type="button" class="danger-button" @click="deleteTimelineEvent(event.id)">Delete</button>
                      </div>
                    </template>
                  </li>
                </ol>
              </div>
            </article>
          </section>
        </div>

        <p v-if="!timelineEventsSorted.length" class="empty-copy">
          Project events will appear here after imports, saved versions, ideas, and daily summaries.
        </p>
      </section>
    </div>

    <Teleport to="body">
      <div
        v-if="isCreateFileModalOpen"
        class="modal-backdrop"
        role="presentation"
        @click.self="closeCreateFileModal"
      >
        <section class="asset-modal create-file-modal" role="dialog" aria-modal="true" aria-labelledby="create-file-title">
          <header class="modal-header">
            <div>
              <p class="eyebrow">New Asset File</p>
              <h2 id="create-file-title">Create file in workspace</h2>
              <p>The file will be created inside this project and added to Asset Library.</p>
            </div>
            <button type="button" class="icon-button close-button" title="Close" @click="closeCreateFileModal">x</button>
          </header>

          <form class="create-file-form" @submit.prevent="createAssetFile">
            <label>
              File type
              <select v-model="createFileForm.fileType">
                <option v-for="option in createFileTypeOptions" :key="option.value" :value="option.value">
                  {{ option.label }}
                </option>
              </select>
            </label>
            <label>
              File name
              <input v-model="createFileForm.fileName" type="text" placeholder="AAAI-2027-draft" autofocus />
            </label>
            <div class="button-row">
              <button type="submit" class="primary-button" :disabled="workbench.loading">Create</button>
              <button type="button" @click="closeCreateFileModal">Cancel</button>
            </div>
          </form>
        </section>
      </div>
    </Teleport>

    <Teleport to="body">
      <div
        v-if="isPlanMemoOpen"
        class="modal-backdrop"
        role="presentation"
        @click.self="isPlanMemoOpen = false"
      >
        <section class="asset-modal plan-memo-modal" role="dialog" aria-modal="true" aria-labelledby="plan-memo-title">
          <header class="modal-header">
            <div>
              <p class="eyebrow">Plan Memo</p>
              <h2 id="plan-memo-title">Expired plan ranges</h2>
              <p>{{ archivedPlanRanges.length }} archived ranges are hidden from the active calendar.</p>
            </div>
            <button type="button" class="icon-button close-button" title="Close" @click="isPlanMemoOpen = false">x</button>
          </header>

          <div v-if="archivedPlanRanges.length" class="plan-memo-list">
            <article
              v-for="range in archivedPlanRanges"
              :key="range.id"
              class="plan-memo-card"
              :style="{ '--plan-bg': resolvePlanColor(range.color) }"
            >
              <header>
                <strong>{{ range.title }}</strong>
                <span>{{ range.startDate }} - {{ range.endDate }}</span>
              </header>
              <p>{{ range.description || 'No description.' }}</p>
              <div class="asset-modal-meta">
                <span>{{ rangeDuration(range) }} days</span>
                <span>{{ range.isDeadline ? 'Deadline' : 'Range' }}</span>
                <span>Archived: {{ range.archivedAt ? new Date(range.archivedAt).toLocaleString() : 'Unknown' }}</span>
              </div>
            </article>
          </div>
          <p v-else class="empty-copy">No expired plan ranges yet.</p>
        </section>
      </div>
    </Teleport>

    <Teleport to="body">
      <div
        v-if="isAssetModalOpen && workbench.selectedAsset"
        class="modal-backdrop"
        role="presentation"
        @click.self="closeAssetDetail"
      >
        <section class="asset-modal" role="dialog" aria-modal="true" aria-labelledby="asset-detail-title">
          <header class="modal-header">
            <div>
              <p class="eyebrow">Asset Detail</p>
              <h2 id="asset-detail-title">{{ workbench.selectedAsset.title }}</h2>
              <p :title="workbench.selectedAsset.filePath">{{ workbench.selectedAsset.filePath }}</p>
            </div>
            <button type="button" class="icon-button close-button" title="Close" @click="closeAssetDetail">x</button>
          </header>

          <div class="asset-modal-meta">
            <span>{{ workbench.selectedAsset.assetKind === 'folder' ? 'Folder' : workbench.selectedAsset.fileType }}</span>
            <span>{{ workbench.selectedAsset.category || 'Uncategorized' }}</span>
            <span>{{ Math.max(1, Math.round(workbench.selectedAsset.sizeBytes / 1024)) }} KB</span>
            <span>Imported: {{ new Date(workbench.selectedAsset.createdAt).toLocaleString() }}</span>
            <span>Last modified: {{ new Date(workbench.selectedAsset.updatedAt).toLocaleString() }}</span>
          </div>

          <form class="asset-title-form" @submit.prevent="saveAssetTitle">
            <label>
              Asset title
              <input v-model="assetTitleForm.title" type="text" placeholder="Asset title" />
            </label>
            <label>
              Category
              <input v-model="assetTitleForm.category" type="text" placeholder="Review task, rebuttal, experiment..." />
            </label>
            <button
              type="submit"
              class="primary-button"
              :disabled="workbench.loading || !assetTitleForm.title.trim() || (isAssetTitleUnchanged && isAssetCategoryUnchanged)"
            >
              Save
            </button>
          </form>

          <div class="button-row">
            <button type="button" @click="workbench.openAsset(workbench.selectedAsset.id)">Open</button>
            <button type="button" @click="workbench.revealAsset(workbench.selectedAsset.id)">Reveal</button>
          </div>

          <form class="version-form modal-version-form" @submit.prevent="saveVersion">
            <input v-model="versionForm.label" type="text" placeholder="version label: v2 / final" />
            <input v-model="versionForm.note" type="text" placeholder="What changed in this version" />
            <button type="submit" :disabled="workbench.loading">
              {{ workbench.selectedAsset.assetKind === 'folder' ? 'Save Folder Snapshot' : 'Save New Version' }}
            </button>
          </form>
          <p v-if="versionError" class="inline-error">{{ versionError }}</p>

          <div class="version-list modal-version-list">
            <button
              v-for="version in selectedAssetVersions"
              :key="version.id"
              type="button"
              class="version-card"
              @click="workbench.openAssetVersion(version.id)"
            >
              <strong>{{ version.label }}</strong>
              <span>{{ new Date(version.createdAt).toLocaleString() }}</span>
              <p>{{ version.note || version.fileName }}</p>
              <small>{{ version.fileName }}</small>
            </button>
          </div>
        </section>
      </div>
    </Teleport>
  </section>

  <section v-else class="empty-state">
    <div>
      <p class="eyebrow">No Project</p>
      <h1>Create a paper submission project from the left sidebar.</h1>
      <p>Examples: AAAI-2027, ICLR rebuttal, Journal extension.</p>
    </div>
  </section>
</template>
