# WealthTrack Frontend

New React/Vite frontend for the WealthTrack rewrite.

## Local Development

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173/`.

During local development, Vite proxies `/api/*` to the existing FastAPI service at `http://127.0.0.1:8000`.

## Cloudflare Pages Preview

Build command:

```bash
npm run build
```

Build output directory:

```text
dist
```

Set this Pages environment variable before using the included `/api/*` proxy:

```text
API_ORIGIN=https://your-current-wealthtrack-api-origin
```

The current backend and database can stay on the existing server while this frontend is previewed on Cloudflare Pages.
