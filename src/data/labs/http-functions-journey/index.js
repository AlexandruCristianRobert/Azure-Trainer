import { HTTP_BASIC_LABS } from './basic.js'
import { HTTP_HOSTING_LABS } from './hosting.js'
import { httpCapstoneLab } from './capstone.lab.js'

export const HTTP_FUNCTIONS_LABS = Object.freeze([...HTTP_BASIC_LABS, ...HTTP_HOSTING_LABS, httpCapstoneLab])
