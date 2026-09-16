# Azure-Trainer

Private, single-user demo: hands-on preparation for exam **AI-200** in a simulated Azure portal.
You complete Labs by typing `az` commands into the Cloud Shell; the portal Blades mirror the
simulated Sandbox and the Lab's Tasks tick live. No real Azure, no accounts, never published.

- Glossary: [CONTEXT.md](./CONTEXT.md) · Spec: [SPEC.md](./SPEC.md) · Decision: [ADR-0001](./docs/adr/0001-simulated-az-cli-over-in-browser-sandbox.md)
- Design: `docs/design/Azure-Trainer Screens.dc.html` (Claude Design export) · Brief: `docs/design-prompt.md`

## Run

```bash
npm install
npm run dev      # http://localhost:5175
npm test
npm run build
```

## What the Cloud Shell understands

`az` (banner), `az --version`, `az version`, `az login`, `az account show|list`,
`az configure --defaults group=<rg> location=<loc>` / `--list-defaults`,
`az group create|show|list|delete|exists`,
`az servicebus namespace create|show|list|update|delete|exists`,
`az servicebus queue create|show|list|update|delete`,
`az servicebus topic create|show|list|delete`,
`az servicebus topic subscription create|show|list|delete`,
`az servicebus topic subscription rule create|show|list|delete`, `clear`.
Every group and command answers `--help`. Output is az-shaped JSON; errors use az wording.

## Icons

Service icons are Microsoft's official Azure architecture icons (permitted for training
materials); control glyphs are Fluent UI System Icons (MIT). Both live under `src/assets/icons/`.

## Progress

Stored in `localStorage` (`at_results`, `at_run_<labId>`). Clear site data to reset everything.
