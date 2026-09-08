# Vendor reconstruct payloads

`repos.ts.gz.b64.00` … are gzip+base64 slices of `worker/src/db/repos.ts`
(including `historyVenueExists`). `npm install` runs `scripts/assemble-repos.mjs`
which concatenates them, inflates, verifies SHA-256, and writes the TypeScript
source. Do not edit the slices by hand.
