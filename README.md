# Global Wine Atlas

A React + Node app for exploring notable wine regions around the world on an interactive map. The map supports pan and zoom, country and region selection, and a Postgres-backed catalog of wines, grapes, and tasting context.

## What it includes

- Full-screen interactive world map powered by MapLibre GL
- Node API backed by local PostgreSQL
- PostgreSQL is the source of truth for region, wine style, wine, and tasting data
- Region details with wines, grapes, styles, and notes
- AI-assisted wine style notes generation using the OpenAI API

## Recommended setup

For hosted environments such as Railway, use a hosted Postgres database such as Supabase and set:

```bash
DATABASE_URL=postgresql://...
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
SUPABASE_STORAGE_BUCKET=wine-atlas-media
```

The app will use `DATABASE_URL` when present. If `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are also set, image uploads and generated wine images will be stored in Supabase Storage instead of the local filesystem. The local Postgres scripts are only for local development.

## Before you push to GitHub

- Keep `.env` out of version control and commit only `.env.example`
- Do not commit `.pgdata/`, `uploads/`, `node_modules/`, or build output
- If you have generated a local dump such as `winemap.dump`, leave it untracked
- If your current `.env` contains live Supabase or OpenAI credentials, rotate them if they were ever exposed

## Environment setup

Copy the example file and fill in your own values:

```bash
cp .env.example .env
```

For local Postgres, you can use the `PG*` variables.

For Supabase or any hosted Postgres, prefer setting just:

```bash
DATABASE_URL=postgresql://...
```

To use Supabase Storage for uploaded and AI-generated images, also set:

```bash
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
SUPABASE_STORAGE_BUCKET=wine-atlas-media
```

## Local database setup only

These commands are only for running a self-managed Postgres instance on your own machine.

Run these once:

```bash
npm run db:local:init
npm run db:local:start
npm run db:local:setup
```

That initializes a self-contained local Postgres data directory in `.pgdata`, starts PostgreSQL on `127.0.0.1:5433`, creates the `winemap` database, and creates the schema. Content is expected to live in PostgreSQL directly.

## Run the app with hosted Postgres

If `DATABASE_URL` points to Supabase or another hosted Postgres:

```bash
npm run dev:hosted-db
```

## Run the app with local Postgres

```bash
npm run dev
```

The React app runs on `http://localhost:3000` and proxies API calls to the Node server on `http://localhost:5001`.

## Deploy on Railway

For Railway:

- connect the GitHub repo as the service source
- set `DATABASE_URL` to your hosted Postgres connection string
- set `SUPABASE_URL`
- set `SUPABASE_SERVICE_ROLE_KEY`
- optionally set `SUPABASE_STORAGE_BUCKET`
- set `OPENAI_API_KEY`
- optionally set `OPENAI_MODEL` and `OPENAI_IMAGE_MODEL`
- use `/api/health` as the healthcheck path

If Supabase direct connection fails in Railway with an IPv6 network error such as `ENETUNREACH`, switch `DATABASE_URL` to the Supabase session pooler connection string on port `5432`.

## OpenAI setup

To enable the AI button on wine style notes, add these to `.env`:

```bash
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-5.6
OPENAI_IMAGE_MODEL=gpt-image-1
```

The prompt templates are stored server-side in `server/aiPrompts.js`.

## Helpful commands

```bash
npm run db:local:start
npm run db:local:stop
npm run db:migrate
npm run db:seed
npm run dev:hosted-db
npm run storage:migrate -- --dry-run
npm run storage:migrate
```

`npm run storage:migrate` uploads any existing local `/uploads/...` wine and tasting images to Supabase Storage and rewrites the database URLs. Run the `--dry-run` form first if you want to preview what will be changed.

## API

- `GET /api/health`
- `GET /api/regions`
- `GET /api/regions/:slug`

## Notes

- The basemap and MapLibre assets are loaded from public CDNs at runtime.
- The application now reads region data from PostgreSQL at runtime.
- The app no longer depends on `data/wineRegions.json`; PostgreSQL is the only active data source.
- Uploaded images use Supabase Storage when `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are configured.
- Without those storage variables, the app falls back to local filesystem uploads for local development.
