import { defineGroup, defineCommand, LATENCY } from '../tree.js'
import { presentAccount } from '../arm.js'

export const loginCommand = defineCommand(['login'], 'Log in to Azure.', {
  latencyMs: LATENCY.read,
  run: ({ sandbox }) => ({ sandbox, output: [presentAccount()] }),
})

export const accountGroup = defineGroup(['account'], 'Manage Azure subscription information.', {
  show: defineCommand(['account', 'show'], 'Get the details of a subscription.', {
    latencyMs: LATENCY.read,
    run: ({ sandbox }) => ({ sandbox, output: presentAccount() }),
  }),
  list: defineCommand(['account', 'list'], 'Get a list of subscriptions for the logged in account.', {
    latencyMs: LATENCY.read,
    run: ({ sandbox }) => ({ sandbox, output: [presentAccount()] }),
  }),
})
