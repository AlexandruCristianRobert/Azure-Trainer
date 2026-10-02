import { sendLab } from './send.lab.js'
import { receiveLab } from './receive.lab.js'
import { deadletterLab } from './deadletter.lab.js'
import { idempotencyLab } from './idempotency.lab.js'
import { topicsLab } from './topics.lab.js'
import { sessionsLab } from './sessions.lab.js'
import { publishEventsLab } from './publish-events.lab.js'
import { eventFiltersLab } from './event-filters.lab.js'
import { eventRecoveryLab } from './event-recovery.lab.js'
import { functionsServicebusLab } from './functions-servicebus.lab.js'
import { functionsEventgridLab } from './functions-eventgrid.lab.js'
import { messagingCapstoneLab } from './capstone.lab.js'
export { messagingCapstoneLab }

export const SERVICEBUS_FOUNDATION_LABS = Object.freeze([sendLab, receiveLab, deadletterLab])
export const SERVICEBUS_ADVANCED_LABS = Object.freeze([idempotencyLab, topicsLab, sessionsLab])
export const EVENTGRID_LABS = Object.freeze([publishEventsLab, eventFiltersLab, eventRecoveryLab])
export const FUNCTIONS_LABS = Object.freeze([functionsServicebusLab, functionsEventgridLab])
export const MESSAGING_LABS = Object.freeze([...SERVICEBUS_FOUNDATION_LABS, ...SERVICEBUS_ADVANCED_LABS, ...EVENTGRID_LABS, ...FUNCTIONS_LABS, messagingCapstoneLab])
