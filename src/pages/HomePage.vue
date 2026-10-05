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
  const group = groups[lab.journeyId] ?? { id: lab.journeyId, title: lab.journeyId === 'containerapps-end-to-end' ? 'Container Apps journey' : lab.journeyId === 'aks-knowledge-assistant' ? 'Kubernetes journey' : lab.journeyId === 'data-knowledge-assistant' ? 'Data journey' : lab.journeyId === 'messaging-orders' ? 'Messaging journey' : lab.journeyId === 'security-observability' ? 'Security and Observability journey' : lab.journeyId === 'http-functions-orders' ? 'HTTP Functions journey' : 'Learning journey', description: lab.journeyId === 'containerapps-end-to-end' ? 'Build an API, publish an image and verify a running deployment.' : lab.journeyId === 'data-knowledge-assistant' ? 'Store, search and cache Knowledge Assistant data with Cosmos DB, PostgreSQL and Redis.' : lab.journeyId === 'messaging-orders' ? 'Build a simulated Order Processing Application with Python, Service Bus, Event Grid and Functions.' : lab.journeyId === 'security-observability' ? 'Secure the Order Processing Application through code: managed identity, vault references, correlated telemetry and computed queries.' : lab.journeyId === 'http-functions-orders' ? 'Build a simulated Python HTTP API for submitting and checking orders, with protected access and asynchronous queue work.' : 'Build and inspect a simulated cloud workload.', labs: [] }
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
