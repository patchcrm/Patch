// Patch — Domain API backend proxy
//
// This is the ONLY place the Domain client secret should ever live.
// Patch's frontend (patch-app.html) never talks to Domain directly —
// it calls this server, and this server calls Domain.
//
// Why this exists: Domain's OAuth2 client credentials flow requires a
// client secret. Secrets must never be embedded in browser-side code
// (anyone can open dev tools and read it). This tiny proxy holds the
// secret, exchanges it for short-lived access tokens, and forwards
// requests to Domain on Patch's behalf.

require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const {
  DOMAIN_CLIENT_ID,
  DOMAIN_CLIENT_SECRET,
  DOMAIN_ENV = 'primary', // 'primary' or 'sandbox'
  DOMAIN_SCOPES = 'api_addresslocators_read',
  PORT = 3001,
} = process.env;

const AUTH_URL = 'https://auth.domain.com.au/v1/connect/token';
const API_BASE = DOMAIN_ENV === 'sandbox'
  ? 'https://api.domain.com.au/sandbox'
  : 'https://api.domain.com.au';

// ---- Token cache ----
// Client credentials tokens are short-lived (typically ~1hr). We cache
// in memory and refresh a little before expiry rather than on every call.
let cachedToken = null;
let tokenExpiresAt = 0;

async function getAccessToken() {
  if (!DOMAIN_CLIENT_ID || !DOMAIN_CLIENT_SECRET) {
    throw new Error(
      'DOMAIN_CLIENT_ID / DOMAIN_CLIENT_SECRET are not set. Copy .env.example to .env and fill them in.'
    );
  }

  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt - 30_000) {
    return cachedToken;
  }

  const body = new URLSearchParams({
    client_id: DOMAIN_CLIENT_ID,
    client_secret: DOMAIN_CLIENT_SECRET,
    grant_type: 'client_credentials',
    scope: DOMAIN_SCOPES,
  });

  const res = await fetch(AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Domain token request failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiresAt = now + (data.expires_in ? data.expires_in * 1000 : 3600_000);
  return cachedToken;
}

async function domainFetch(path, options = {}) {
  const token = await getAccessToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(`Domain API error (${res.status})`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

function handleDomainError(res, err) {
  console.error(err);
  res.status(err.status || 500).json({
    error: err.message || 'Unknown error calling Domain API',
    detail: err.body || null,
  });
}

// ---- Address Suggestions ----
// Package you currently have enabled. Confirm the exact scope name
// (DOMAIN_SCOPES in .env) against what your Domain portal shows when
// you create an API client against this package — "api_addresslocators_read"
// is the scope documented for the related /v1/addressLocators endpoint;
// verify it matches what your project's credential screen lists.
app.get('/api/address-suggest', async (req, res) => {
  const { terms } = req.query;
  if (!terms) return res.status(400).json({ error: 'Missing ?terms=' });
  try {
    const data = await domainFetch(`/v1/properties/_suggest?terms=${encodeURIComponent(terms)}`);
    res.json(data);
  } catch (err) {
    handleDomainError(res, err);
  }
});

// ---- Agents & Listings (requires that package to be added to your project) ----
// Search residential listings — this is what would feed Patch's
// "Active Listings" market layer with real data instead of mock data.
app.post('/api/listings/residential/search', async (req, res) => {
  try {
    const data = await domainFetch('/v1/listings/residential/_search', {
      method: 'POST',
      body: JSON.stringify(req.body),
    });
    res.json(data);
  } catch (err) {
    handleDomainError(res, err);
  }
});

// ---- Properties & Locations (requires that package to be added to your project) ----
// Suburb performance stats — median prices, recent sale counts, etc.
// This is what would feed Patch's "Recent Sales" layer and the
// suburb-wide coverage denominator with real figures.
app.get('/api/suburb-performance/:state/:suburb', async (req, res) => {
  const { state, suburb } = req.params;
  try {
    const data = await domainFetch(`/v2/suburbPerformanceStatistics/${state}/${encodeURIComponent(suburb)}`);
    res.json(data);
  } catch (err) {
    handleDomainError(res, err);
  }
});

// ---- Listings Management (sandbox, write access — package you have) ----
// Example: take a listing off-market. This package requires DOMAIN_ENV=sandbox
// during testing, and Domain's sandbox data resets every Sunday.
app.post('/api/listings/residential/offmarket', async (req, res) => {
  try {
    const data = await domainFetch('/v1/listings/residential/offmarket', {
      method: 'POST',
      body: JSON.stringify(req.body),
    });
    res.json(data);
  } catch (err) {
    handleDomainError(res, err);
  }
});

app.get('/health', (req, res) => res.json({ ok: true, env: DOMAIN_ENV }));

app.listen(PORT, () => {
  console.log(`Patch Domain proxy listening on http://localhost:${PORT} (env: ${DOMAIN_ENV})`);
});
