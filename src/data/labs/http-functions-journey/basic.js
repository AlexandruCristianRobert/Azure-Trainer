import { httpStartLab } from './start.lab.js'
import { httpStatusLab } from './status.lab.js'
import { httpValidationLab } from './validation.lab.js'
import { httpEnqueueLab } from './enqueue.lab.js'
import { httpRetriesLab } from './retries.lab.js'

export const HTTP_BASIC_LABS = Object.freeze([httpStartLab, httpStatusLab, httpValidationLab, httpEnqueueLab, httpRetriesLab])
