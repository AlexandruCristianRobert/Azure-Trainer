<script setup>
import ServicesRow from '../components/home/ServicesRow.vue'
import SkillAreaCard from '../components/home/SkillAreaCard.vue'
import LabCard from '../components/home/LabCard.vue'
import { SKILL_AREAS } from '../data/skillAreas.js'
import { LABS } from '../data/labs/index.js'
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
      <LabCard v-for="lab in LABS" :key="lab.id" :lab="lab" />
    </div>
  </main>
</template>
