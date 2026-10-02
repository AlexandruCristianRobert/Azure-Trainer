import { sendLab } from './send.lab.js'
import { receiveLab } from './receive.lab.js'
import { deadletterLab } from './deadletter.lab.js'

export const SERVICEBUS_FOUNDATION_LABS = Object.freeze([sendLab, receiveLab, deadletterLab])
