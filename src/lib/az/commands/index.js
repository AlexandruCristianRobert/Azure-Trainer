import { defineGroup } from '../tree.js'
import { versionCommand } from './misc.js'
import { accountGroup, loginCommand } from './account.js'
import { configureCommand } from './configure.js'
import { groupGroup } from './group.js'
import { servicebusGroup } from './servicebus.js'

let AZ_TREE = null

export function buildTree() {
  if (AZ_TREE) return AZ_TREE
  AZ_TREE = defineGroup([], 'Azure CLI (Sandbox)', {
    account: accountGroup,
    configure: configureCommand,
    group: groupGroup,
    login: loginCommand,
    servicebus: servicebusGroup,
    version: versionCommand,
  })
  return AZ_TREE
}
