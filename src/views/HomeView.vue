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

const setCover = async (projectId: string, event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''

  if (!file) return

  const reader = new FileReader()
  reader.onload = async () => {
    if (typeof reader.result === 'string') {
      await workbench.setProjectCover(projectId, reader.result)
    }
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

    <div v-if="projectCards.length" class="project-card-grid">
      <article v-for="{ project, metrics } in projectCards" :key="project.id" class="project-card">
        <div class="project-cover" :style="project.coverPath ? { backgroundImage: `url(${project.coverPath})` } : {}">
          <span v-if="!project.coverPath">{{ project.title.slice(0, 2).toUpperCase() }}</span>
        </div>

        <div class="project-card-body">
          <div class="project-card-title">
            <div>
              <h2>{{ project.title }}</h2>
              <p>{{ project.researchDirection || 'Research direction not set' }}</p>
            </div>
            <span class="stage-pill">{{ getProjectStageLabel(project.stage) }}</span>
          </div>

          <dl class="project-meta">
            <div>
              <dt>Target venue</dt>
              <dd>{{ project.targetVenue || 'Not set' }}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{{ formatDate(project.createdAt) }}</dd>
            </div>
            <div>
              <dt>Updated</dt>
              <dd>{{ formatDate(project.updatedAt) }}</dd>
            </div>
            <div>
              <dt>Assets</dt>
              <dd>{{ metrics.assetCount }}</dd>
            </div>
            <div>
              <dt>Timeline days</dt>
              <dd>{{ metrics.timelineDays }}</dd>
            </div>
          </dl>

          <p class="project-description">{{ project.description || 'No project note yet.' }}</p>

          <div class="card-actions">
            <button type="button" class="primary-button" @click="openProject(project.id)">Open</button>
            <button type="button" @click="startEdit(project)">Edit</button>
            <label class="file-action">
              Cover
              <input class="visually-hidden" type="file" accept="image/*" @change="setCover(project.id, $event)" />
            </label>
            <button type="button" @click="workbench.exportProjectPackage(project.id)">Export</button>
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
