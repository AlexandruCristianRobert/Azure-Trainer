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
const journeyLabs = LABS.filter((lab) => lab.journeyId === 'containerapps-end-to-end').sort((a, b) => a.journeyOrder - b.journeyOrder)
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
    <section v-if="journeyLabs.length" class="home__journey" aria-label="Container Apps learning journey"><h2 class="home__section">Container Apps journey</h2><p>Build an API, publish an image and verify a running deployment.</p><div class="home__labs"><LabCard v-for="lab in journeyLabs" :key="lab.id" :lab="lab" /></div></section>
  </main>
</template>
