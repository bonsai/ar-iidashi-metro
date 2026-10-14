# Voice-to-Artifact Workflow

## Goal

From a spoken creation request on a phone, create an artifact in a cloud or notebook-backed worker, then inspect it in a browser. Start with a deterministic demo image; add image generation, video, and Blender animation later.

## Components

1. **ChatGPT voice interface** — captures the user's spoken request and helps structure it as a creation brief.
2. **Webhook/action bridge** — forwards an approved, structured request to the production API. This bridge must be explicitly configured; the ChatGPT mobile voice interface does not automatically call an arbitrary URL merely because it is mentioned in conversation.
3. **Cloudflare Pages** — hosts the browser UI and artifact gallery.
4. **Cloudflare Worker** — accepts jobs, validates inputs, tracks status, and exposes a polling API.
5. **Colab notebook runner (Python)** — while the notebook runtime is active, polls for jobs, executes Python/model/Blender work, and submits status/results.
6. **Artifact storage** — Cloudflare R2 or another configured object store. Store metadata and status separately from binary files.
7. **GitHub Actions** — runs tests and deploys the static UI/Worker when code changes. It is not assumed to provide a persistent GPU worker or a permanently running Colab session.

## End-to-end flow

1. User speaks a request.
2. A configured action/webhook bridge sends POST /api/jobs with JSON.
3. Worker validates the request, creates a job_id, and returns 202 Accepted.
4. Active Colab runner polls GET /api/runner/jobs/next with runner authentication.
5. Runner executes the selected task and uploads the artifact using a short-lived upload URL or authenticated upload endpoint.
6. Runner calls POST /api/runner/jobs/{job_id}/complete or /fail.
7. Browser UI polls GET /api/jobs/{job_id} and displays status and the result.
8. User reviews the result. Any public deployment or external publishing step requires an explicit approval action.

## First vertical slice

- No model download and no GPU required.
- Request a demo image/job using a fixed sample PNG or a small Python-generated SVG/PNG.
- Verify job creation, runner polling, result upload, status transitions, and browser preview.
- Add real image generation only after this flow works end-to-end.

## Runtime caveats

- Colab is an interactive, temporary runtime, not a guaranteed always-on production server. Jobs remain queued while no runner is active.
- Prefer outbound HTTPS polling from Colab to the Worker. This avoids exposing a Colab inbound port and usually removes the need for a tunnel.
- A tunnel is an optional alternative for development callbacks or direct inspection, not a prerequisite for the polling design.
- Never commit API keys, GitHub tokens, Cloudflare credentials, signed URLs, or model-provider secrets.
