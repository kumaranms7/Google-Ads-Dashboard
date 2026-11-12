# GAds Dashboard

A Windows desktop app for managing, auditing and optimizing Google Ads accounts, with AI-assisted tools for building ads, assets and keyword strategy. Built by **Top Ten Website Marketing**.

Electron + React + the Google Ads API, with Claude (Anthropic) providing the AI features. Your credentials and data stay on your machine.

## Features

**Reporting & analysis**
- **Dashboard**: KPI cards, performance charts, campaign and ad group breakdowns, call/lead tracking and an AI chat panel to ask questions about the account.
- **Reports**: campaign, ad group, ad, keyword, search term and wasted-spend reports with CSV and PDF export.
- **Keywords**: keyword performance with signals, AI keyword ideas, CPC optimization and negative keyword recommendations, publishable straight to the account.
- **Audit**: overview, campaign, performance, ad/RSA, asset, duplicate and conversion-tracking audits, with AI recommendations.

**Account management**
- **Campaign Manager**: create and edit campaigns.
- **Ad / Asset Group Manager**: create and edit ad groups and Performance Max asset groups, with a changelog.
- **Keywords Manager**: add, edit, pause and remove keywords and negatives.

**AI builders**
- **AI RSA Builder**: generates Responsive Search Ad headlines and descriptions from keywords and a landing-page analysis. It scores ads, enforces Google's character limits, and supports publishing, editing and rollback.
- **AI Assets Builder**: sitelinks, callouts, call assets, structured snippets and campaign-level text assets.

## Tech stack

| Layer | Technology |
|---|---|
| Desktop shell | Electron 40 |
| UI | React 18, Vite, React Router, Recharts |
| Data | `google-ads-api`, `electron-store` |
| AI | `@anthropic-ai/sdk` |
| Export | jsPDF, html2canvas |
| Tests | Vitest |
| Packaging | electron-builder (NSIS installer and portable, Windows x64) |

## Prerequisites

- Node.js 18+ and npm
- A Google Ads **developer token** and an OAuth client (client ID/secret, refresh token), plus a manager (MCC) account ID if you use one
- An **Anthropic API key** for the AI features

## Getting started

```bash
npm install
npm run dev
```

`npm run dev` starts Vite and launches Electron once the dev server is up. Open **Settings** in the app and enter your Google Ads and Anthropic credentials. They are stored locally with `electron-store`.

> On some shells `ELECTRON_RUN_AS_NODE=1` is set, which breaks Electron. `scripts/start-electron.js` clears it, so use `npm run dev` rather than calling `electron` directly.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Run the app in development |
| `npm run build` | Build the React front end into `dist/` |
| `npm run dist` | Build and package the Windows installer and portable exe into `dist-exe/` |
| `npm test` | Run the unit tests |

## Code signing (optional)

Packaging can sign the executable. Copy `scripts/sign-config.example.json` to `scripts/sign-config.json` and fill it in. See `scripts/build-signed.ps1`, `scripts/create-cert.ps1` and `scripts/install-cert.ps1`. Never commit your certificate (`.pfx`) or `sign-config.json`.

## Project structure

```
electron/   Main process: IPC handlers, Google Ads clients, AI calls, local store
src/        React UI: pages, components, hooks, services (RSA scoring, prompts)
scripts/    Dev launcher, build and signing scripts
docs/       Feature documentation and prompt references
assets/     App icons
```

## Documentation

See [docs/](docs/) for the AI RSA Builder feature documentation and the prompt references.

## Security notes

- API keys and tokens are kept in local app storage, not in the repository.
- Changes made through the app (publishing ads, keywords, assets) are applied to the live Google Ads account. Review before you publish.

## License

Proprietary. © Top Ten Website Marketing. All rights reserved.
