<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { getProjectStageLabel, useWorkbenchStore } from '@/stores/workbench'
import type { AssetSummaryKey, Idea, TimelineEvent, TimelineExportFormat } from '@/types'

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

const summariesDraft = reactive<Record<string, string>>({})
const isAssetModalOpen = ref(false)
const assetRefreshTimer = ref<number | null>(null)
const versionError = ref('')
const timelinePage = ref(1)
const editingTimelineId = ref('')
const editingIdeaId = ref('')

const timelineEditForm = reactive({
  title: '',
  description: '',
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
      await workbench.selectProject(projectId)
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

const selectedAssetVersions = computed(() => workbench.assetVersions)
const today = computed(() => new Date().toISOString().slice(0, 10))
const assetStats = computed<Record<AssetSummaryKey, number>>(() => {
  const stats = {
    md: 0,
    ppt: 0,
    images: 0,
    papers: 0,
    word: 0,
    data: 0,
    other: 0,
  }

  for (const asset of workbench.assets) {
    if (asset.fileType === 'markdown') stats.md += 1
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
  { key: 'md', label: 'md', count: assetStats.value.md },
  { key: 'ppt', label: 'ppt', count: assetStats.value.ppt },
  { key: 'images', label: 'images', count: assetStats.value.images },
  { key: 'papers', label: 'papers', count: assetStats.value.papers },
  { key: 'word', label: 'word', count: assetStats.value.word },
  { key: 'data', label: 'data', count: assetStats.value.data },
  { key: 'other', label: 'other', count: assetStats.value.other },
])

const timelineEventsSorted = computed(() =>
  [...workbench.events].sort((a, b) => a.eventDate.localeCompare(b.eventDate)),
)

const timelinePageSize = 8
const timelinePageCount = computed(() =>
  Math.max(1, Math.ceil(timelineEventsSorted.value.length / timelinePageSize)),
)

const pagedTimelineEvents = computed(() => {
  const start = (timelinePage.value - 1) * timelinePageSize
  return timelineEventsSorted.value.slice(start, start + timelinePageSize)
})

const pagedTimelineDays = computed(() => {
  const grouped = new Map<string, TimelineEvent[]>()

  for (const event of pagedTimelineEvents.value) {
    const day = event.eventDate.slice(0, 10)
    grouped.set(day, [...(grouped.get(day) ?? []), event])
  }

  return [...grouped.entries()].map(([day, events]) => ({
    day,
    events,
    summary: summariesDraft[day] ?? '',
  }))
})

watch(
  () => timelineEventsSorted.value.length,
  () => {
    timelinePage.value = timelinePageCount.value
  },
  { immediate: true },
)

watch(timelinePageCount, (count) => {
  if (timelinePage.value > count) timelinePage.value = count
})

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
}

onBeforeUnmount(stopAssetRefresh)

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
  <section v-if="workbench.activeProject" class="project-page">
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
        <input v-model="workbench.searchQuery" type="search" placeholder="Search title, tag, type, or idea" />
        <button type="button" class="primary-button" :disabled="workbench.loading" @click="chooseImport">
          Import Assets
        </button>
        <input ref="fileInput" class="visually-hidden" type="file" multiple @change="importBrowserFiles" />
      </div>
    </header>

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
          <article
            v-for="asset in workbench.filteredAssets"
            :key="asset.id"
            class="asset-row"
            :class="{ active: asset.id === workbench.selectedAssetId }"
          >
            <button type="button" class="asset-main" @click="openAssetDetail(asset.id)">
              <span class="file-type">{{ asset.fileType }}</span>
              <strong>{{ asset.title }}</strong>
              <small>{{ asset.originalName }}</small>
              <span class="tag-row">
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

        <article v-for="day in pagedTimelineDays" :key="day.day" class="day-group">
          <div class="day-header">
            <h3>{{ day.day }}</h3>
            <button type="button" :disabled="workbench.loading" @click="saveSummary(day.day)">Save Summary</button>
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
        </article>

        <div v-if="timelineEventsSorted.length" class="pagination-row">
          <button type="button" :disabled="timelinePage <= 1" @click="timelinePage -= 1">Previous</button>
          <span>Page {{ timelinePage }} / {{ timelinePageCount }}</span>
          <button
            type="button"
            :disabled="timelinePage >= timelinePageCount"
            @click="timelinePage += 1"
          >
            Next
          </button>
        </div>

        <p v-if="!timelineEventsSorted.length" class="empty-copy">
          Project events will appear here after imports, saved versions, ideas, and daily summaries.
        </p>
      </section>
    </div>

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
            <span>{{ workbench.selectedAsset.fileType }}</span>
            <span>{{ Math.max(1, Math.round(workbench.selectedAsset.sizeBytes / 1024)) }} KB</span>
            <span>Imported: {{ new Date(workbench.selectedAsset.createdAt).toLocaleString() }}</span>
            <span>Last modified: {{ new Date(workbench.selectedAsset.updatedAt).toLocaleString() }}</span>
          </div>

          <div class="button-row">
            <button type="button" @click="workbench.openAsset(workbench.selectedAsset.id)">Open</button>
            <button type="button" @click="workbench.revealAsset(workbench.selectedAsset.id)">Reveal</button>
          </div>

          <form class="version-form modal-version-form" @submit.prevent="saveVersion">
            <input v-model="versionForm.label" type="text" placeholder="version label: v2 / final" />
            <input v-model="versionForm.note" type="text" placeholder="What changed in this version" />
            <button type="submit" :disabled="workbench.loading">Save New Version</button>
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
