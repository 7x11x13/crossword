# Database update investigation

Issue: https://github.com/7x11x13/crossword/issues/2

## Confirmed production failure

The live cron invocation at 2026-09-09 03:00:07 UTC failed with outcome
`exception`. Cloudflare reported:

```text
SyntaxError: Unexpected token '<', "<!doctype "... is not valid JSON
    at async tryUpdatePollData (index.js:6944:16)
    at async Object.scheduled (index.js:6988:7)
```

The missing-date log begins July 18, 2026 and ends September 3, 2026.
The exception occurs when parsing the Reddit search response, before any
insert. The sequential loop then aborts, leaving the backlog unchanged.

Direct D1 reads confirmed 2,059 rows and a latest date of July 17, 2026.
The cron is still configured for every 15 minutes. The active deployment is
from July 11, 2025. XWordInfo returned valid July 18 metadata when checked
from the development machine.

The original code does not record HTTP status or response type. HTML could
indicate a Reddit access block or another upstream error; the logs do not
establish the exact status or whether the access token was valid.

## Diagnostic patch deployed

Deployed on September 9, 2026 at approximately 03:09 UTC as Worker version
`3cdbc8e9-446a-4b9c-9adf-4256bce35d0a`, with user approval. All seven regression
tests, TypeScript checks, and the Wrangler dry-run build passed. The live API
returned HTTP 200 after deployment. Cloudflare settings confirm persistent logs
are enabled and all four Reddit secret bindings remain present.

- Validate authentication tokens and Reddit listing structure.
- Report upstream HTTP status and content type without exposing response bodies
  or credentials; apply a 30-second request timeout.
- Encode the OAuth password grant with URLSearchParams.
- Stop on shared upstream failures, leaving dates available for retry.
- Continue past individual poll failures and fail the overall run visibly.
- Enable stored Worker logs and upgrade Wrangler within major version 3 to
  support that configuration.
- Add regression tests for HTML responses, missing tokens, malformed listings,
  preserving missing dates on access failure, and continuing after a bad poll.

## Remaining recovery steps

The first diagnostic cron at 2026-09-09 03:15:36 UTC found 48 missing dates
and failed before search with:

```text
Reddit authentication: HTTP 401, content-type application/json; request rejected
```

Stored log ID: `01M222KWKJ000000000000000B`.

This confirms that Reddit rejects the Worker's token request. Verify the Reddit
application's client ID and secret and whether it retains API access. The
presence of Cloudflare secret bindings does not establish that their values are
valid. A response body was deliberately not logged; the exact reason for the
credential rejection and the historical triggering event remain unconfirmed.

The earlier implementation did not validate the token response and could proceed
to Reddit search without a usable token, where the HTML response caused the
visible JSON parse error. The diagnostic patch now stops at authentication.

After Reddit search returns valid listings, the existing missing-date mechanism
can retry the backlog. Verify actual poll inserts and the newest database date
before declaring recovery; a deployment or successful HTTP read is insufficient.

## Proposed recovery implementation

The anonymous mobile client has now passed a nine-date read-only sample locally
and on Cloudflare's edge. The implementation replaces the rejected password grant
and improves exact-date search while retaining failed dates for retry. See
[validation and rollout details](redlib-worker-probe.md). The credential diagnosis
above records the original failure; the proposed client does not use those credentials.
No production backfill has yet been performed.
