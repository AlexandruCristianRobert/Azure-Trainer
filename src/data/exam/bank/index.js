import { CONTAINERS_QUESTIONS, CONTAINERS_GROUPS, CONTAINERS_REFERENCES } from './containers.js'
import { DATA_QUESTIONS, DATA_GROUPS, DATA_REFERENCES } from './data.js'
import { CONNECT_QUESTIONS, CONNECT_GROUPS, CONNECT_REFERENCES } from './connect.js'
import { SECURE_QUESTIONS, SECURE_GROUPS, SECURE_REFERENCES } from './secure.js'

// No deduplication: conflicting reused IDs must reach validation and be rejected.
export const EXAM_BANK = Object.freeze({
  version:1, revision:1,
  questions:[...CONTAINERS_QUESTIONS,...DATA_QUESTIONS,...CONNECT_QUESTIONS,...SECURE_QUESTIONS],
  groups:[...CONTAINERS_GROUPS,...DATA_GROUPS,...CONNECT_GROUPS,...SECURE_GROUPS],
  references:[...CONTAINERS_REFERENCES,...DATA_REFERENCES,...CONNECT_REFERENCES,...SECURE_REFERENCES],
})
