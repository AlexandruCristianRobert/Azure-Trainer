import { sendLab } from './send.lab.js'
import { receiveLab } from './receive.lab.js'
import { deadletterLab } from './deadletter.lab.js'
import { idempotencyLab } from './idempotency.lab.js'
import { topicsLab } from './topics.lab.js'
import { sessionsLab } from './sessions.lab.js'

export const SERVICEBUS_FOUNDATION_LABS = Object.freeze([sendLab, receiveLab, deadletterLab])
export const SERVICEBUS_ADVANCED_LABS = Object.freeze([idempotencyLab, topicsLab, sessionsLab])
