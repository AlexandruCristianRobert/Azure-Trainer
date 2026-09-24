export function behavioralLab() {
  return {
    id: 'behavioral-lab',
    engineVersion: 2,
    contentVersion: 1,
    seed: (sandbox) => ({
      ...sandbox,
      resourceGroups: [{ name: 'seeded-rg', location: 'westeurope' }],
    }),
    initialProjectFiles: { 'src/app.txt': 'healthy' },
    tasks: [
      {
        id: 'request',
        text: 'Verify the healthy request.',
        check: (context) => context.project.savedFiles['src/app.txt'] === 'healthy',
        dependencies: {
          application: (context) => ({
            source: context.project.savedFiles['src/app.txt'],
            route: '/health',
          }),
        },
        verification: { scenarioId: 'healthy-request', scenarioVersion: 1 },
      },
      {
        id: 'configured',
        text: 'Keep the seeded resource group.',
        check: (context) => context.sandbox.resourceGroups.some((group) => group.name === 'seeded-rg'),
      },
    ],
  }
}
