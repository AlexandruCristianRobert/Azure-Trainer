import { PROJECT_MANIFEST, SOLUTION_FILES } from './starter.js'

const api = 'src/Trainer.Api'
const healthState = `namespace Trainer.Api;

// Trainer fault hooks supply these flags in the bounded simulation. This helper is a
// compilable teaching surface; the trainer does not execute learner C#.
public static class HealthState
{
    private static readonly DateTime StartedAt = DateTime.UtcNow;
    public static bool StartupComplete => DateTime.UtcNow - StartedAt >= TimeSpan.FromSeconds(20);
    public static bool Ready { get; set; } = true;
    public static bool Responsive { get; set; } = true;
    public static bool DependencyAvailable { get; set; } = true;
}
`

const healthRoutes = (startup, ready, live) => [
  `app.MapGet("/health/startup", () => ${startup} ? Results.Ok() : Results.StatusCode(503));`,
  `app.MapGet("/health/ready", () => ${ready} ? Results.Ok() : Results.StatusCode(503));`,
  `app.MapGet("/health/live", () => ${live} ? Results.Ok() : Results.StatusCode(503));`,
].join('\n')

export function probeConfiguration({ appName, image, probes = [] }) {
  return `${JSON.stringify({ properties: { template: { containers: [{ name: appName, image,
    env: [{ name: 'APP_ENV', value: 'training' }], resources: { cpu: 0.5, memory: '1Gi' }, probes }],
  scale: { minReplicas: 2, maxReplicas: 2 } } } }, null, 2)}\n`
}

const initialConfig = probeConfiguration({ appName: 'api', image: 'acrprobesguided.azurecr.io/api:v1', probes: [] })
const extend = (files, startup, ready, live) => ({ ...files,
  [`${api}/Program.cs`]: files[`${api}/Program.cs`].replace('app.Run(', `${healthRoutes(startup, ready, live)}\napp.Run(`),
  [`${api}/HealthState.cs`]: healthState,
  'containerapp.yaml': initialConfig,
})

export const PROBE_MANIFEST = Object.freeze({ ...PROJECT_MANIFEST, id: 'containerapps-dotnet-probes-v1',
  files: [...PROJECT_MANIFEST.files, `${api}/HealthState.cs`, 'containerapp.yaml'],
  fixedFiles: Object.freeze({ ...PROJECT_MANIFEST.fixedFiles, [`${api}/HealthState.cs`]: healthState }),
  healthProbes: true,
})
export const PROBE_STARTER_FILES = Object.freeze(extend(SOLUTION_FILES, 'false', 'false', 'false'))
export const PROBE_SOLUTION_FILES = Object.freeze(extend(SOLUTION_FILES, 'HealthState.StartupComplete', 'HealthState.Ready', 'HealthState.Responsive'))
