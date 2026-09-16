import { defineCommand, LATENCY } from '../tree.js'

export const BANNER = String.raw`
     /\
    /  \    _____   _ _  ___ _
   / /\ \  |_  / | | | \'__/ _\
  / ____ \  / /| |_| | | |  __/
 /_/    \_\/___|\__,_|_|  \___|


Welcome to the cool new Azure CLI!

Use ` + '`az --version`' + ` to display the current version.
Here are the base commands:
`

export const VERSION_JSON = { 'azure-cli': '2.78.0', 'azure-cli-core': '2.78.0', 'azure-cli-telemetry': '1.1.0', extensions: {} }

export const VERSION_TEXT = `azure-cli                         2.78.0

core                              2.78.0
telemetry                          1.1.0

Dependencies:
msal                            1.34.0
azure-mgmt-resource             23.4.0

Python location '/usr/bin/python3.12'
Config directory '/home/user/.azure'
Extensions directory '/home/user/.azure/cliextensions'

Python (Linux) 3.12.3

Legal docs and information: aka.ms/AzureCliLegal


Your CLI is up-to-date.`

export const versionCommand = defineCommand(['version'], 'Show the versions of Azure CLI modules and extensions in JSON format by default or format configured by --output.', {
  latencyMs: LATENCY.read,
  run: ({ sandbox }) => ({ sandbox, output: VERSION_JSON }),
})
