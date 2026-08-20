# Deployment — Render (server) + Vercel (client)

Two services, one repo. The client stays on relative `/api/...` calls in
production too — Vercel proxies them to Render server-side via a rewrite, so
there's no CORS handshake and no `VITE_API_URL` build-time env var to manage.

Order matters: **deploy the server first**, copy its `.onrender.com` URL into
`vercel.json`, then deploy the client.

---

## 1. Render — server

### Push the repo to GitHub first
Render deploys from a Git repo (GitHub/GitLab/Bitbucket), not a local folder.
If this repo isn't pushed yet:

```bash
git remote add origin <your-empty-github-repo-url>
git push -u origin main
```

### Create the service

Two ways — pick one.

**A. Blueprint (recommended)** — the repo already has `render.yaml` at the root.
On [dashboard.render.com](https://dashboard.render.com) → **New → Blueprint** →
pick this repo → Render reads `render.yaml` and creates the service with the
settings below pre-filled. You only need to fill in the two `sync: false`
env vars (`DATABASE_URL`, `CORS_ORIGIN`) in the dashboard after creation.

**B. Manual web service** — **New → Web Service** → pick this repo → fill in:

| Field | Value |
|---|---|
| Root Directory | *(leave blank — repo root)* |
| Runtime | Node |
| Build Command | `npm install && npm run db:generate --workspace=server && npm run build --workspace=server` |
| Pre-Deploy Command | `npm run db:deploy --workspace=server` |
| Start Command | `npm run start --workspace=server` |
| Health Check Path | `/api/health` |

*(Pre-Deploy Command runs after build, before the new version takes traffic —
the right place for `prisma migrate deploy`. If your plan doesn't expose that
field, append `&& npm run db:deploy --workspace=server` to the Build Command
instead.)*

### Environment variables (Render dashboard → Environment)

| Key | Value |
|---|---|
| `DATABASE_URL` | your real Neon connection string (from `server/.env`) |
| `NODE_VERSION` | `20.18.0` |
| `CORS_ORIGIN` | your Vercel URL once you have it, e.g. `https://scheduledesk.vercel.app` — optional (see note below), leave unset while testing |
| `ADMIN_PASSWORD` | the password the timetable office signs in with. **Required** — without it nobody can reach the admin side. The public timetable and class-adjustment pages keep working either way |
| `SESSION_SECRET` | any long random string; signs the admin session cookie. Optional — one is derived from `ADMIN_PASSWORD` if unset. Changing either signs everyone out |
| `NODE_ENV` | `production` — makes the session cookie `Secure` |
| `PORT` | not needed — Render sets this itself and Express already reads `process.env.PORT` |

Deploy. Copy the resulting URL, e.g. `https://scheduledesk-api.onrender.com`.
Confirm it's alive:

```bash
curl https://scheduledesk-api.onrender.com/api/health
# {"status":"ok"}
```

Note on free-tier Render: the service spins down after inactivity and the
first request after a while takes ~30–60s to wake up. Fine for an internal
single-admin tool; worth knowing so a slow first load isn't mistaken for a bug.

**If the site shows "The API server isn't responding":** that is almost always
this — the Render service asleep, still deploying, or crashed at boot. Vercel's
rewrite gives up waiting and returns an HTML error page, which is not JSON. The
app now says so in plain language instead of showing a JSON parse error. Check
in this order:

```bash
curl -i https://<your-api>.onrender.com/api/health   # should be {"status":"ok"}
```

- Times out or takes ~45s → it was asleep. Reload the site; it is awake now.
- `502`/`503` → the service crashed at boot. Open **Render → Logs**. The usual
  cause is a missing or wrong `DATABASE_URL`, which the server reports on the
  first lines of its log.
- Works, but the site still fails → the `destination` in `vercel.json` points at
  the wrong host. Fix it and redeploy the client.

---

## 2. Vercel — client

`vercel.json` at the repo root already has the build settings and a rewrite
that proxies `/api/*` to Render. Before deploying, put the real Render URL in:

```bash
# edit vercel.json — replace the placeholder in "destination"
"destination": "https://scheduledesk-api.onrender.com/api/:path*"
```

Commit that change, then deploy.

**Dashboard**: [vercel.com/new](https://vercel.com/new) → import this repo →
Vercel reads `vercel.json` automatically (Root Directory stays at repo root —
don't set it to `client/`, since the build command needs the workspace root).
No environment variables are required. Deploy.

**Or via CLI**:

```bash
npm install -g vercel
vercel login
vercel --prod
```

Once deployed, go back to Render and set `CORS_ORIGIN` to the Vercel URL
Vercel gives you, e.g. `https://scheduledesk.vercel.app` (comma-separate if
you later add a custom domain). This isn't strictly required — the browser
only ever talks to the Vercel domain, which proxies to Render server-side, so
the cross-origin request never happens from the browser's point of view — but
it's a cheap extra lock on the API in case someone calls the Render URL
directly.

---

## 3. Verify

```bash
curl https://<your-vercel-domain>/api/health
# {"status":"ok"}  — confirms the rewrite proxy is reaching Render
```

Then open the Vercel URL, walk through Term Setup → Master Data → Curriculum
once, and confirm a save round-trips to the Neon database (check Prisma
Studio or just reload the page).

---

## Redeploying after schema changes

Both platforms redeploy automatically on `git push` to the connected branch.
A new migration in `prisma/migrations/` is picked up by Render's Pre-Deploy
Command (`prisma migrate deploy`) on the next deploy — nothing extra to run
by hand.

## What NOT to run in production

`npm run db:migrate` (`prisma migrate dev`) is interactive and can prompt to
reset the database — it's for local development only. Production always uses
`npm run db:deploy` (`prisma migrate deploy`), which only applies migrations
that already exist in the repo and never prompts.
