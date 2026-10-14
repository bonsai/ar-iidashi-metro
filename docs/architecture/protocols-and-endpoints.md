# Protocols and API Endpoints

## Transport and formats

- Browser ↔ Cloudflare Pages/Worker: HTTPS.
- ChatGPT/action bridge ↔ Worker: HTTPS webhook/action call with JSON.
- Colab runner ↔ Worker: outbound HTTPS polling and JSON.
- Runner ↔ artifact storage: HTTPS upload/download; use short-lived signed URLs where supported.
- Request/status payloads: JSON with UTF-8.
- Static UI deployment: GitHub Actions workflow triggered by repository events.
- Optional live progress: begin with browser polling; add Server-Sent Events only if needed. WebSocket is not required for the first PoC.
- MCP: an optional tool integration layer for calling production capabilities; it is not the network transport required for every component.

## Proposed API

| Method | Path | Purpose |
| --- | --- | --- |
| POST | /api/jobs | Validate a creation request and enqueue a job |
| GET | /api/jobs/{job_id} | Return job status and artifact metadata |
| POST | /api/jobs/{job_id}/approve | Record explicit approval for a publish/deploy step |
| GET | /api/runner/jobs/next | Lease the next queued job to an authenticated runner |
| POST | /api/runner/jobs/{job_id}/heartbeat | Extend the active job lease |
| POST | /api/runner/jobs/{job_id}/complete | Mark a job successful and register artifact metadata |
| POST | /api/runner/jobs/{job_id}/fail | Mark a job failed and record a safe error summary |

These are design proposals only; they are not live endpoints until implemented and deployed.

## Example job request

~~~json
{
  "task": "demo_image",
  "input": {
    "prompt": "A low-poly fish in a deep-sea scene",
    "output_format": "png"
  },
  "options": {
    "preview": true
  }
}
~~~

Expected response:

~~~json
{
  "job_id": "job_demo_001",
  "status": "queued",
  "status_url": "/api/jobs/job_demo_001"
}
~~~

The API should return HTTP 202 Accepted for a successfully queued asynchronous job.

## Security

- Authenticate runner endpoints independently from public job-status endpoints.
- Apply request size limits, rate limits, schema validation, and CORS allowlists.
- Keep secrets in Cloudflare Worker secrets, GitHub Actions secrets, or notebook secret storage as appropriate.
- Never put privileged tokens in browser JavaScript or a public repository.
- Validate artifact content type, size, and object key; do not accept arbitrary filesystem paths.
- Require explicit approval before making a generated artifact public or triggering an external publish action.

## Deployment boundaries

- GitHub Actions tests and deploys code; it does not keep Colab alive.
- Cloudflare Worker handles short API requests and job metadata; do not run long GPU tasks inside it.
- Colab performs generation only while its runtime is active.
- Pages displays the review UI; artifacts should live in object storage or another stable host, not in an ephemeral Colab filesystem.
