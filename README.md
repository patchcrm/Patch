# Patch — Domain API backend proxy

This is a small server that holds your Domain API client secret and
forwards requests from Patch's frontend to Domain's API. Patch's
frontend (`patch-app.html`) never talks to Domain directly and never
sees your secret.

## One important thing to know before you start

Domain's docs are explicit about this, and it changes how you test:

> The Sandbox environment is for testing new Listing Management
> applications, and other applications that require write access to
> the API... It is NOT for testing regular read-only style
> applications.

So:
- **Address Suggestions, Agents & Listings, Properties & Locations**
  (read-only) — you test these against the **Primary** environment
  (`https://api.domain.com.au/`), typically with a trial/limited grant
  on your project, not the sandbox.
- **Listings Management** (write — creating/updating/taking listings
  off-market) — this is what sandbox (`https://api.domain.com.au/sandbox/`)
  is actually for. Sandbox data resets every Sunday night.

Set `DOMAIN_ENV=primary` or `DOMAIN_ENV=sandbox` in `.env` depending on
which feature you're testing — you may end up running two separate
API clients/projects in Domain's portal for this reason.

## Setup

```bash
cd patch-backend
npm install
cp .env.example .env
```

Open `.env` and fill in:
- `DOMAIN_CLIENT_ID` / `DOMAIN_CLIENT_SECRET` — from your project's
  credentials screen in the Domain developer portal.
- `DOMAIN_SCOPES` — when you create an API client in the portal against
  a package (e.g. Address Suggestions), the portal shows you the exact
  scope name(s) available. Copy those in exactly — the value in
  `.env.example` is a best guess based on public docs, not a guarantee.
- `DOMAIN_ENV` — `primary` or `sandbox` (see above).

Then run it:

```bash
npm start
```

You should see `Patch Domain proxy listening on http://localhost:3001`.

## Test it

```bash
curl "http://localhost:3001/health"
curl "http://localhost:3001/api/address-suggest?terms=1+Broadway+Glenelg"
```

If you get a 401/403 from Domain, the most common causes are: wrong
scope name, package not yet actually granted to your project (some
packages need Domain to approve/activate them even after you request
them — Listings Management explicitly requires emailing them), or
using `sandbox` for a read-only endpoint (see above).

## What's wired up vs. what's a stub

| Endpoint | Package needed | Status |
|---|---|---|
| `GET /api/address-suggest` | Address Suggestions | You have this — should work once `.env` is filled in |
| `POST /api/listings/residential/search` | Agents & Listings | Stubbed — you don't have this package yet |
| `GET /api/suburb-performance/:state/:suburb` | Properties & Locations | Stubbed — you don't have this package yet |
| `POST /api/listings/residential/offmarket` | Listings Management (sandbox) | You have this — untested example |

"Stubbed" means the route exists and will work as soon as you add the
package to your project — no code changes needed, just add the
package and the right scope to `DOMAIN_SCOPES`.

## Connecting Patch's frontend

In `patch-app.html`, the address search box calls
`http://localhost:3001/api/address-suggest`. If you run this backend
somewhere other than localhost:3001, update that URL in the HTML file.

## Security notes

- `.env` is listed in `.gitignore` — never commit it.
- Never paste your client secret into a chat, ticket, or screenshot.
- This proxy has no auth of its own yet — anyone who can reach
  `localhost:3001` (or wherever you deploy it) can use your Domain
  quota. Fine for local development; before deploying anywhere
  reachable by others, add your own auth in front of it (e.g. require
  Patch's own login session).
