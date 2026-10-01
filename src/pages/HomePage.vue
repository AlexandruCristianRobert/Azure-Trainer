<script setup>
import ServicesRow from '../components/home/ServicesRow.vue'
import SkillAreaCard from '../components/home/SkillAreaCard.vue'
import LabCard from '../components/home/LabCard.vue'
import { SKILL_AREAS } from '../data/skillAreas.js'
import { LABS } from '../data/labs/index.js'
import { onMounted } from 'vue'
import { useProgressStore } from '../stores/progress.js'
const progress = useProgressStore()
const legacyLabs = LABS.filter((lab) => lab.engineVersion !== 2)
const journeys = Object.values(LABS.filter(lab => lab.engineVersion === 2 && lab.journeyId).reduce((groups, lab) => {
  const group = groups[lab.journeyId] ?? { id: lab.journeyId, title: lab.journeyId === 'containerapps-end-to-end' ? 'Container Apps journey' : lab.journeyId === 'aks-knowledge-assistant' ? 'Kubernetes journey' : lab.journeyId === 'data-knowledge-assistant' ? 'Data journey' : 'Learning journey', description: lab.journeyId === 'containerapps-end-to-end' ? 'Build an API, publish an image and verify a running deployment.' : lab.journeyId === 'data-knowledge-assistant' ? 'Store, search and cache Knowledge Assistant data with Cosmos DB, PostgreSQL and Redis.' : 'Build and inspect a simulated cloud workload.', labs: [] }
  group.labs.push(lab); groups[lab.journeyId] = group; return groups
}, {})).map(group => ({ ...group, labs: group.labs.sort((a, b) => a.journeyOrder - b.journeyOrder) }))
onMounted(() => { void progress.hydrateNative().catch(() => {}) })
</script>

<template>
  <main class="home">
    <div class="home__crumb">Home</div>
    <h2 class="home__section">Azure services</h2>
    <ServicesRow />
    <h2 class="home__section">Labs by Skill Area</h2>
    <div class="home__areas">
      <SkillAreaCard v-for="area in SKILL_AREAS" :key="area.id" :area="area" />
    </div>
    <h2 id="labs" class="home__section">Labs</h2>
    <div class="home__labs">
      <LabCard v-for="lab in legacyLabs" :key="lab.id" :lab="lab" />
    </div>
    <section v-for="journey in journeys" :key="journey.id" class="home__journey" :aria-label="`${journey.title} learning journey`"><h2 class="home__section">{{ journey.title }}</h2><p>{{ journey.description }}</p><div class="home__labs"><LabCard v-for="lab in journey.labs" :key="lab.id" :lab="lab" /></div></section>
  </main>
</template>
