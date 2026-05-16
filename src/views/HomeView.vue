<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  getProjectStageLabel,
  projectStageOptions,
  useWorkbenchStore,
} from '@/stores/workbench'
import type { Project, ProjectStage } from '@/types'

const router = useRouter()
const workbench = useWorkbenchStore()
const editingProjectId = ref('')
const coverTargetId = ref('')
const coverInput = ref<HTMLInputElement | null>(null)
const selectingCover = ref(false)

const editForm = reactive({
  title: '',
  description: '',
  researchDirection: '',
  stage: 'idea' as ProjectStage,
  targetVenue: '',
  tags: '',
})

const projectCards = computed(() =>
  workbench.projects.map((project) => ({
    project,
    metrics: workbench.getProjectMetrics(project.id),
  })),
)

const formatDate = (value: string) => new Date(value).toLocaleDateString()

const coverUrl = (coverPath: string) => {
  if (!coverPath) return ''
  if (/^(data:|https?:|file:|paper-cover:)/i.test(coverPath)) return coverPath
  return `paper-cover://local/${encodeURIComponent(coverPath)}`
}

const coverStyle = (coverPath: string) =>
  coverPath ? { backgroundImage: `url("${coverUrl(coverPath)}")` } : {}

const openProject = async (projectId: string) => {
  await workbench.selectProject(projectId)
  await router.push(`/projects/${projectId}`)
}

const startEdit = (project: Project) => {
  editingProjectId.value = project.id
  editForm.title = project.title
  editForm.description = project.description
  editForm.researchDirection = project.researchDirection
  editForm.stage = project.stage
  editForm.targetVenue = project.targetVenue
  editForm.tags = project.tags.join(', ')
}

const cancelEdit = () => {
  editingProjectId.value = ''
}

const saveEdit = async () => {
  if (!editingProjectId.value || !editForm.title.trim()) return

  await workbench.updateProject(editingProjectId.value, {
    title: editForm.title.trim(),
    description: editForm.description.trim(),
    researchDirection: editForm.researchDirection.trim(),
    stage: editForm.stage,
    targetVenue: editForm.targetVenue.trim(),
    tags: editForm.tags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean),
  })
  editingProjectId.value = ''
}

const triggerCoverUpload = async (projectId: string) => {
  if (selectingCover.value || workbench.loading) return

  coverTargetId.value = projectId

  if (workbench.usingDesktop) {
    selectingCover.value = true
    try {
      await workbench.setProjectCover(projectId, '')
    } finally {
      selectingCover.value = false
      coverTargetId.value = ''
    }
    return
  }

  coverInput.value?.click()
}

const handleCoverFile = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]

  if (!file || !coverTargetId.value) {
    input.value = ''
    return
  }

  const reader = new FileReader()
  reader.onload = async () => {
    if (typeof reader.result === 'string') {
      await workbench.setProjectCover(coverTargetId.value, reader.result)
    }
    input.value = ''
    coverTargetId.value = ''
  }
  reader.readAsDataURL(file)
}
</script>

<template>
  <section class="project-dashboard">
    <header class="dashboard-header">
      <div>
        <p class="eyebrow">My Submission Projects</p>
        <h1>我的投稿项目</h1>
        <p>Open a project to manage assets, ideas, versions, and its research timeline.</p>
      </div>
      <button type="button" class="primary-button" @click="workbench.chooseWorkspace">
        Select Workspace
      </button>
    </header>

    <input
      ref="coverInput"
      class="visually-hidden"
      type="file"
      accept="image/*"
      @change="handleCoverFile"
    />

    <div v-if="projectCards.length" class="project-card-grid">
      <article v-for="{ project, metrics } in projectCards" :key="project.id" class="project-card">
        <div
          class="project-cover"
          :class="{ 'has-image': project.coverPath }"
          :style="coverStyle(project.coverPath)"
          :title="project.coverPath ? 'Click to change cover' : 'Click to upload cover'"
          @click="triggerCoverUpload(project.id)"
        >
          <span v-if="!project.coverPath" class="cover-placeholder">
            {{ project.title.slice(0, 2).toUpperCase() }}
          </span>
          <span class="cover-overlay">
            {{ project.coverPath ? 'Change Cover' : 'Upload Cover' }}
          </span>
        </div>

        <div class="project-card-body">
          <div class="project-card-title">
            <h2>{{ project.title }}</h2>
            <span class="stage-pill" :class="`stage-${project.stage}`">
              {{ getProjectStageLabel(project.stage) }}
            </span>
          </div>

          <p class="project-direction">
            {{ project.researchDirection || 'Research direction not set' }}
          </p>

          <p class="project-description">
            {{ project.description || 'No project note yet.' }}
          </p>

          <div class="project-meta-chips">
            <span v-if="project.targetVenue" class="meta-chip">
              {{ project.targetVenue }}
            </span>
            <span class="meta-chip">
              {{ metrics.assetCount }} assets
            </span>
            <span class="meta-chip">
              {{ metrics.timelineDays }} days
            </span>
            <span class="meta-chip">
              {{ formatDate(project.updatedAt) }}
            </span>
          </div>

          <div class="card-actions">
            <button type="button" class="primary-button" @click="openProject(project.id)">
              Open
            </button>
            <button type="button" @click="startEdit(project)">
              Edit
            </button>
            <button type="button" :disabled="selectingCover" @click.stop="triggerCoverUpload(project.id)">
              Cover
            </button>
            <button type="button" @click="workbench.exportProjectPackage(project.id)">
              Export
            </button>
          </div>

          <form v-if="editingProjectId === project.id" class="project-edit-form" @submit.prevent="saveEdit">
            <input v-model="editForm.title" type="text" placeholder="Project name" />
            <input v-model="editForm.researchDirection" type="text" placeholder="Research direction" />
            <div class="form-row">
              <input v-model="editForm.targetVenue" type="text" placeholder="Target venue" />
              <select v-model="editForm.stage">
                <option v-for="stage in projectStageOptions" :key="stage.value" :value="stage.value">
                  {{ stage.label }}
                </option>
              </select>
            </div>
            <input v-model="editForm.tags" type="text" placeholder="tags: recommendation, LLM" />
            <textarea v-model="editForm.description" rows="3" placeholder="Project notes" />
            <div class="button-row">
              <button type="submit" class="primary-button">Save</button>
              <button type="button" @click="cancelEdit">Cancel</button>
            </div>
          </form>
        </div>
      </article>
    </div>

    <section v-else class="empty-state compact-empty">
      <div>
        <p class="eyebrow">No Project</p>
        <h1>先在左侧创建一个投稿项目。</h1>
        <p>Examples: AAAI-2027 Drug Recommendation, CIKM-2027 Causal Recommendation.</p>
      </div>
    </section>
  </section>
</template>
