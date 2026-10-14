# Colab Runner: Environment and Operation Notes

## Role

Colab is an on-demand Python execution environment for generation tasks. It is a worker, not the public API and not the website.

## Recommended connection: outbound polling (A)

The notebook initiates HTTPS requests to the Cloudflare Worker. No inbound port needs to be exposed.

1. Start the notebook and install only the dependencies needed for the selected job.
2. Load the Worker base URL and runner token from notebook secrets or runtime environment variables.
3. Poll GET /api/runner/jobs/next with a bounded interval and authenticated request.
4. If a job is returned, acknowledge/lease it before processing.
5. Execute the task in a temporary working directory.
6. Upload the output through a short-lived upload URL or authenticated upload route.
7. Report success/failure and delete temporary files when safe.
8. Stop cleanly when the notebook is interrupted; the Worker keeps unclaimed jobs queued.

## Job contract

Example job payload:

~~~json
{
  "job_id": "job_demo_001",
  "task": "demo_image",
  "input": {
    "prompt": "A simple low-poly deep-sea fish",
    "format": "png"
  },
  "callback": {
    "complete": "/api/runner/jobs/job_demo_001/complete",
    "fail": "/api/runner/jobs/job_demo_001/fail"
  }
}
~~~

Example completion payload:

~~~json
{
  "status": "succeeded",
  "artifact": {
    "key": "jobs/job_demo_001/result.png",
    "content_type": "image/png",
    "width": 512,
    "height": 512
  }
}
~~~

These are proposed contracts for the PoC, not deployed endpoints.

## Reliability

- Use a lease/visibility timeout so abandoned jobs can be retried.
- Make completion idempotent by job_id.
- Track states: queued, running, succeeded, failed, cancelled.
- Include attempt count, timestamps, error code, and a short safe error message.
- Limit output size and task duration; do not trust arbitrary notebook job code from requests.
- Keep credentials out of notebook output and logs.

## Tunnel option (B)

A Cloudflare Tunnel or similar tunnel may be useful for temporary inbound callbacks or development inspection. It adds tunnel lifecycle, authentication, and URL-rotation concerns. Do not make the core PoC depend on a manually copied tunnel URL if outbound polling meets the requirements.

## Limitations

Colab sessions can disconnect, reset, or become unavailable and must not be treated as an always-on service. A queued job may wait until a runner is started. For reliable continuous execution, use a dedicated worker service later.
