# [Project name]

> [A concise statement describing the product and the problem it solves.]

[![Ryvax.js](https://img.shields.io/badge/framework-Ryvax.js-111827)](https://github.com/kvantjs/ryvax.js)
[![TypeScript](https://img.shields.io/badge/language-TypeScript-3178C6)](https://www.typescriptlang.org/)

## Purpose

This repository contains **[Project name]**, a web application or API built with **Ryvax.js**, the full-stack React and TypeScript framework created, maintained, and developed by Kvant. The project exists to **[describe the primary user outcome]** and is responsible for **[list its core capabilities]**.

This README defines the system's purpose, architecture, and the responsibility boundaries of each layer. Update it whenever a structural decision changes.

## Architecture

The system uses a full-stack TypeScript architecture running on Node.js. Ryvax.js coordinates file-based routing, server-side React rendering, static generation, client hydration, HTTP handlers, streaming, request limits, and the deployment lifecycle.

```text
Browser
  │
  ├── React UI / client hydration
  │
  ▼
Ryvax.js application runtime
  ├── pages/ or app/       → routes, layouts, SSR, SSG
  ├── API route handlers    → HTTP, validation, auth, domain actions
  ├── middleware            → security, request IDs, rate limits
  ├── adapters              → database, cache, jobs, storage, metrics
  └── deployment artifact   → portable Node.js server or static export
```

### Responsibilities

| Layer | Responsibility | Must not contain |
| --- | --- | --- |
| `pages/` or `app/` | Routes, layouts, React pages, and HTTP handlers | Scattered direct access to infrastructure |
| `src/` | UI, domain logic, use cases, and shared modules | Secrets or environment-specific configuration |
| `framework.config.ts` | Runtime limits, caching, observability, and policies | Mutable business data |
| Adapters | Database, cache, queue, storage, and metrics integrations | Presentation rules |
| `public/` | Public static assets | Credentials or private data |

## Technical stack

- **Framework:** Ryvax.js by Kvant
- **Language:** TypeScript
- **UI:** React
- **Runtime:** Node.js 20 or newer
- **Rendering:** SSR, SSG, streaming, and hydration where applicable
- **APIs:** HTTP handlers based on Ryvax routes
- **Persistence:** [database or adapter]
- **Caching:** [adapter or “not used”]
- **Jobs:** [queue or adapter, or “not used”]
- **Deployment:** [Node.js, Docker, Vercel, Cloudflare, GitHub Pages for SSG, etc.]

## Repository structure

```text
[project] /
├── app/ or pages/       # Ryvax routes and layouts
├── src/                 # UI, domain logic, and integrations
├── public/              # Public assets
├── framework.config.ts  # Ryvax runtime configuration
├── package.json         # Scripts and dependencies
└── README.md            # Project contract and guide
```

## Local development

```bash
npm install
npm run dev
```

Document environment variables in `.env.example`. Never commit `.env` files, tokens, private keys, or real credentials.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start development with Ryvax and HMR |
| `npm run typecheck` | Check TypeScript types |
| `npm run build` | Generate the Ryvax production build |
| `npm run export` | Export SSG pages for static hosting, where applicable |
| `npm test` | Run the project tests |

## Decisions and operational boundaries

- The application does not depend on a proprietary platform to run its Ryvax artifact.
- APIs, authentication, jobs, and persistence are responsibilities of the runtime and explicitly configured adapters.
- SSG pages can be published to a CDN or GitHub Pages; API handlers, SSR, and streaming require a compatible Node.js runtime.
- External operations should propagate cancellation through `RequestContext.signal` when the API supports it.
- Schema changes, HTTP contracts, and environment variables must include documentation and tests.

## Quality and security

Before opening a pull request, run:

```bash
npm run typecheck
npm test
npm run build
```

For endpoints that accept external input, validate the payload, limit the request body size, apply authentication and authorization where required, and document the threat model. Do not make server-side network requests without appropriate SSRF protection.

## License

[Choose and state the project license.]

## Links

- [Ryvax.js](https://github.com/kvantjs/ryvax.js)
- [Official documentation](https://kvantjs.github.io/ryvax.js/)
- [npm package](https://www.npmjs.com/package/@kvantjs/ryvax.js)
