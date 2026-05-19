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
          <small>Local timeline and knowledge manager</small>
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
          <span>New Space</span>
        </div>
        <p class="new-project-copy">
          Track a paper, work stream, study plan, meeting series, or daily journal in one timeline.
        </p>
        <div class="use-case-row" aria-label="Example spaces">
          <span>Work</span>
          <span>Study</span>
          <span>Meetings</span>
          <span>Diary</span>
          <span>Paper</span>
        </div>
        <form @submit.prevent="createProject">
          <input v-model="projectForm.title" type="text" placeholder="Weekly work log / Group meeting / AAAI-2027" />
          <input v-model="projectForm.researchDirection" type="text" placeholder="Theme or area: product, study, lab, life" />
          <select v-model="projectForm.stage">
            <option v-for="stage in projectStageOptions" :key="stage.value" :value="stage.value">
              {{ stage.label }}
            </option>
          </select>
          <input v-model="projectForm.targetVenue" type="text" placeholder="Goal, venue, cadence, or owner" />
          <textarea v-model="projectForm.description" rows="3" placeholder="What should this space help you remember, plan, or move forward?" />
          <input v-model="projectForm.tags" type="text" placeholder="tags: work, study, diary, paper" />
          <button class="primary-button" type="submit" :disabled="workbench.loading">Create Space</button>
        </form>
      </section>

      <nav class="project-list" aria-label="Projects">
        <button
          v-for="project in workbench.visibleProjects"
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
