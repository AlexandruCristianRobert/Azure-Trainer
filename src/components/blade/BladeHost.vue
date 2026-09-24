<script setup>
import { computed } from 'vue'
import { useLabRunStore } from '../../stores/labRun.js'
import { usePortalStore } from '../../stores/portal.js'
import { resolveBlade } from '../../lib/bladeResolve.js'
import ResourceGroupsBlade from './ResourceGroupsBlade.vue'
import ResourceGroupBlade from './ResourceGroupBlade.vue'
import ServiceBusNamespaceBlade from './ServiceBusNamespaceBlade.vue'
import ContainerAppEnvironmentBlade from './ContainerAppEnvironmentBlade.vue'
import ContainerAppBlade from './ContainerAppBlade.vue'
import CosmosAccountBlade from './CosmosAccountBlade.vue'
import CosmosDatabaseBlade from './CosmosDatabaseBlade.vue'
import CosmosContainerBlade from './CosmosContainerBlade.vue'
import KeyVaultBlade from './KeyVaultBlade.vue'
import KeyVaultSecretBlade from './KeyVaultSecretBlade.vue'
import StorageAccountBlade from './StorageAccountBlade.vue'
import FunctionAppBlade from './FunctionAppBlade.vue'
import EventGridTopicBlade from './EventGridTopicBlade.vue'
import EventGridSubscriptionBlade from './EventGridSubscriptionBlade.vue'
import ContainerRegistryBlade from './ContainerRegistryBlade.vue'
import ManagedIdentityBlade from './ManagedIdentityBlade.vue'

const run = useLabRunStore()
const portal = usePortalStore()
const blade = computed(() => resolveBlade(portal.blade, run.sandbox))
</script>

<template>
  <ContainerRegistryBlade v-if="blade.kind === 'container-registry'" :key="blade.resourceGroup + '/' + blade.name" :resource-group="blade.resourceGroup" :name="blade.name" />
  <ManagedIdentityBlade v-else-if="blade.kind === 'managed-identity'" :key="blade.resourceGroup + '/' + blade.name" :resource-group="blade.resourceGroup" :name="blade.name" />
  <EventGridSubscriptionBlade v-else-if="blade.kind === 'eventgrid-subscription'" :key="blade.resourceGroup + '/' + blade.topic + '/' + blade.name" :resource-group="blade.resourceGroup" :topic="blade.topic" :name="blade.name" />
  <EventGridTopicBlade v-else-if="blade.kind === 'eventgrid-topic'" :key="blade.resourceGroup + '/' + blade.name" :resource-group="blade.resourceGroup" :name="blade.name" />
  <FunctionAppBlade v-else-if="blade.kind === 'function-app'" :key="blade.resourceGroup + '/' + blade.name" :resource-group="blade.resourceGroup" :name="blade.name" />
  <StorageAccountBlade v-else-if="blade.kind === 'storage-account'" :key="blade.resourceGroup + '/' + blade.name" :resource-group="blade.resourceGroup" :name="blade.name" />
  <KeyVaultSecretBlade v-else-if="blade.kind === 'key-vault-secret'" :key="blade.resourceGroup + '/' + blade.vault + '/' + blade.name" :resource-group="blade.resourceGroup" :vault="blade.vault" :name="blade.name" />
  <KeyVaultBlade v-else-if="blade.kind === 'key-vault'" :key="blade.resourceGroup + '/' + blade.name" :resource-group="blade.resourceGroup" :name="blade.name" />
  <CosmosContainerBlade v-else-if="blade.kind === 'cosmos-container'" :key="blade.resourceGroup + '/' + blade.account + '/' + blade.database + '/' + blade.name" :resource-group="blade.resourceGroup" :account="blade.account" :database="blade.database" :name="blade.name" />
  <CosmosDatabaseBlade v-else-if="blade.kind === 'cosmos-database'" :key="blade.resourceGroup + '/' + blade.account + '/' + blade.name" :resource-group="blade.resourceGroup" :account="blade.account" :name="blade.name" />
  <CosmosAccountBlade v-else-if="blade.kind === 'cosmos-account'" :key="blade.resourceGroup + '/' + blade.name" :resource-group="blade.resourceGroup" :name="blade.name" />
  <ContainerAppEnvironmentBlade v-else-if="blade.kind === 'containerapp-environment'" :key="blade.resourceGroup + '/' + blade.name" :resource-group="blade.resourceGroup" :name="blade.name" />
  <ContainerAppBlade v-else-if="blade.kind === 'containerapp'" :key="blade.resourceGroup + '/' + blade.name" :resource-group="blade.resourceGroup" :name="blade.name" />
  <ServiceBusNamespaceBlade v-else-if="blade.kind === 'servicebus-namespace'" :key="blade.resourceGroup + '/' + blade.name" :resource-group="blade.resourceGroup" :name="blade.name" :tab="blade.tab" />
  <ResourceGroupBlade v-else-if="blade.kind === 'resource-group'" :key="blade.name" :name="blade.name" />
  <ResourceGroupsBlade v-else />
</template>
