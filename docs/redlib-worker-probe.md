# Anonymous Reddit client validation

The updater now uses a fetch-only anonymous mobile session in `backend/src/reddit.ts`.
It obtains a bearer token once per cron invocation, retains Reddit's returned
session headers, and searches for exact dates in discussion titles. It needs no
Reddit username, password, app ID, or app secret. The deployment workflow no longer
uploads those secrets. Existing stored secrets need not be removed for this change.

The request protocol is informed by [Redlib's authentication source](https://github.com/redlib-org/redlib/blob/main/src/oauth.rs).
This is independent TypeScript using Web APIs, without Redlib's Rust runtime,
browser networking emulation, rendering, or background refresh daemon. It still
relies on Reddit's unofficial anonymous authentication and API endpoints; future
access is not guaranteed.

## Live validation

On September 9, 2026 (US Eastern; September 10 UTC), the shared production client
successfully retrieved all nine sampled polls locally under Node 22 and through
an isolated Cloudflare remote preview. The preview used the production Worker’s
`2024-07-25` compatibility date. Edge invocation start:
`2026-09-10T01:06:53.311Z`.

| Date | Excellent | Good | Average | Poor | Terrible | Results only | Total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 07/17/2026 | 125 | 261 | 61 | 15 | 4 | 95 | 561 |
| 07/18/2026 | 27 | 137 | 99 | 40 | 9 | 109 | 421 |
| 07/25/2026 | 68 | 188 | 65 | 36 | 18 | 88 | 463 |
| 08/01/2026 | 10 | 81 | 118 | 187 | 106 | 160 | 662 |
| 08/08/2026 | 9 | 101 | 138 | 135 | 33 | 134 | 550 |
| 08/15/2026 | 20 | 111 | 128 | 90 | 38 | 128 | 515 |
| 08/22/2026 | 23 | 137 | 99 | 26 | 16 | 93 | 394 |
| 08/29/2026 | 37 | 158 | 94 | 27 | 19 | 103 | 438 |
| 09/03/2026 | 19 | 153 | 176 | 91 | 25 | 112 | 576 |

July 17 matches all six counts previously read from D1. July 18 is the first
missing date. Every sample had six distinct expected labels, nonnegative integer
counts, a closed voting period, and a total matching the sum of option counts.
The read-only probes do not write to D1. No production backfill has been executed.

The original broad search (`NYT MM/DD/YYYY Discussion`, limit 5) sometimes omitted
existing discussions while returning unrelated dates. Quoted date searches using
Reddit's `title:` field retrieved the whole sample. Empty/unmatched searches now
leave dates missing for retry instead of permanently inserting `pollExists: false`.
A genuinely absent discussion therefore remains retryable and requires review.

The earlier experimental web-client fallback returned HTTP 401 locally and on
Cloudflare. It is not included in the production client. Requests use manual
redirect handling and reject non-2xx responses without forwarding credentials.

## Reproduce

From `backend`, with Node 22+ and project dependencies installed:

```sh
npm run probe:reddit
# Optional explicit dates:
npm run probe:reddit -- 07/17/2026 07/18/2026
```

The script calls the same provider as the updater. It prints public poll counts
or sanitized errors, never tokens, and exits nonzero on failure.

Using an authenticated Wrangler 4 installation, from `backend`:

```sh
wrangler dev --config experiments/wrangler.jsonc --remote --ip 127.0.0.1 --port 8791
curl -X POST 'http://127.0.0.1:8791/probe'
```

The separate preview config has no database bindings or cron triggers. Stop the
preview after testing; do not deploy the diagnostic handler as a public service.

## Production behavior and checks

- Process up to 15 missing dates per invocation to bound backfill subrequests.
- Reuse one anonymous session; stop if it expires or an upstream request fails.
- Bound upstream bodies to 2 MB and requests to 15 seconds; sanitize failures.
- Leave open/malformed polls and failed searches available for retry.
- Validate counts before requesting metadata or inserting a row. Preserve the
  existing rating formula and exclude results-only votes from rating denominators.
- Record structured progress/errors and expose partial failures in cron logs.

Validation: 19 offline regression tests, TypeScript checks, and the production
Wrangler dry-run bundle passed. A PR workflow runs those checks without credentials.
After deployment, confirm actual inserts and the newest D1 date before declaring
the incident resolved. These samples do not establish coverage of every missing
poll or long-term availability.
