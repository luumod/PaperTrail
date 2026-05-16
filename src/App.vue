<script setup lang="ts">
import { onMounted, reactive } from 'vue'
import { RouterLink, RouterView, useRouter } from 'vue-router'
import { projectStageOptions, useWorkbenchStore } from '@/stores/workbench'
import type { ProjectStage } from '@/types'

const router = useRouter()
const workbench = useWorkbenchStore()

const projectForm = reactive({
  title: '',
  description: '',
  researchDirection: '',
  stage: 'idea' as ProjectStage,
  targetVenue: '',
  tags: '',
})

onMounted(async () => {
  await workbench.init()
})

const chooseWorkspace = async () => {
  await workbench.chooseWorkspace()
}

const createProject = async () => {
  if (!projectForm.title.trim()) {
    workbench.error = 'Project title is required.'
    return
  }

  const project = await workbench.createProject({
    title: projectForm.title.trim(),
    description: projectForm.description.trim(),
    researchDirection: projectForm.researchDirection.trim(),
    stage: projectForm.stage,
    targetVenue: projectForm.targetVenue.trim(),
    tags: projectForm.tags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean),
  })
  projectForm.title = ''
  projectForm.description = ''
  projectForm.researchDirection = ''
  projectForm.stage = 'idea'
  projectForm.targetVenue = ''
  projectForm.tags = ''

  if (project) {
    await router.push(`/projects/${project.id}`)
  }
}

const selectProject = async (projectId: string) => {
  await workbench.selectProject(projectId)
  await router.push(`/projects/${projectId}`)
}
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar">
      <RouterLink class="brand" to="/">
        <span class="brand-mark">PT</span>
        <span>
          <strong>Paper Timeline Workbench</strong>
          <small>Local research process manager</small>
        </span>
      </RouterLink>

      <section class="workspace-panel">
        <div class="section-title">
          <span>Workspace</span>
          <button
            type="button"
            class="icon-button"
            title="Select workspace"
            :disabled="workbench.loading"
            @click="chooseWorkspace"
          >
            ...
          </button>
        </div>
        <p class="path-label" :title="workbench.workspacePath">
          {{ workbench.workspacePath || 'No workspace selected' }}
        </p>
        <p class="runtime-label">
          {{ workbench.usingDesktop ? 'Electron mode: SQLite + file copy' : 'Browser demo mode: localStorage' }}
        </p>
      </section>

      <p v-if="workbench.error" class="error-banner">{{ workbench.error }}</p>
      <p v-else-if="workbench.loading" class="status-banner">Working...</p>

      <section class="new-project">
        <div class="section-title">
          <span>New Project</span>
        </div>
        <form @submit.prevent="createProject">
          <input v-model="projectForm.title" type="text" placeholder="AAAI-2027" />
          <input v-model="projectForm.researchDirection" type="text" placeholder="Drug Recommendation / LLM" />
          <select v-model="projectForm.stage">
            <option v-for="stage in projectStageOptions" :key="stage.value" :value="stage.value">
              {{ stage.label }}
            </option>
          </select>
          <input v-model="projectForm.targetVenue" type="text" placeholder="AAAI-2027 / CIKM-2027" />
          <textarea v-model="projectForm.description" rows="3" placeholder="Submission notes and scope" />
          <input v-model="projectForm.tags" type="text" placeholder="tags: RL, survey" />
          <button class="primary-button" type="submit" :disabled="workbench.loading">Create Project</button>
        </form>
      </section>

      <nav class="project-list" aria-label="Projects">
        <button
          v-for="project in workbench.projects"
          :key="project.id"
          type="button"
          :class="{ active: project.id === workbench.activeProjectId }"
          @click="selectProject(project.id)"
        >
          <strong>{{ project.title }}</strong>
          <small>{{ project.description || 'No description yet' }}</small>
        </button>
      </nav>
    </aside>

    <main class="content">
      <RouterView />
    </main>
  </div>
</template>
