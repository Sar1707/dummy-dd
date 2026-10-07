# dummy-project

A small learning sandbox that copies the flexipill-internal stack (pnpm + Turborepo + Vite 8 + React 19 + TanStack Router/Query + axios + zod + Tailwind v4).
Use it to practise deploying a static single-page app (SPA) to GCP:
**Cloud Build → GCS bucket → HTTPS Load Balancer + Cloud CDN**.

## Routes and API calls

| Route | API call (jsonplaceholder.typicode.com) |
|---|---|
| `/` | `GET /users` |
| `/users/$userId` | `GET /users/:id` |

Open `/users/3` directly in the browser to test deep links. The hosting has to serve `index.html` for this URL. On GCP that's the job of the Load Balancer's custom error response.

## Commands

```bash
pnpm install
pnpm dev                                  # http://localhost:3003  (env: local)
pnpm --filter dashboard build:staging     # → apps/dashboard/dist  (env: staging)
pnpm --filter dashboard build:production  # → apps/dashboard/dist  (env: production)
```

Env values are baked in at build time from `apps/dashboard/env/.env.<mode>`. The badge in the header shows which build you're looking at.
These files are committed on purpose: they hold no secrets, and Cloud Build only sees what's in git.
