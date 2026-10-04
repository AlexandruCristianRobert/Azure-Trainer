import { securityIdentityLab } from './identity.lab.js'
import { securitySecretsLab } from './secrets.lab.js'
import { securityRotationLab } from './rotation.lab.js'
import { securityConfigurationLab } from './configuration.lab.js'
import { securityRefreshLab } from './refresh.lab.js'

export const SECURITY_LABS = [securityIdentityLab, securitySecretsLab, securityRotationLab, securityConfigurationLab, securityRefreshLab]
