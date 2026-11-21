// netlify/functions/fetch-all.js

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

const PRIMARY_TIMEOUT_MS = 10000;
const FALLBACK_TIMEOUT_MS = 7000;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_ENTRIES = 200;

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Module-scoped cache & in-flight map (persists across warm invocations)
const responseCache = new Map();
const inFlightRequests = new Map();

function jsonResponse(statusCode, payload, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      ...JSON_HEADERS,
      ...extraHeaders,
    },
    body: JSON.stringify(payload),
  };
}

function roundCoord(val, decimals = 3) {
  const factor = Math.pow(10, decimals);
  return Math.round(val * factor) / factor;
}

function buildCacheKey(minLat, minLon, maxLat, maxLon) {
  return [
    roundCoord(minLat, 3),
    roundCoord(minLon, 3),
    roundCoord(maxLat, 3),
    roundCoord(maxLon, 3),
  ].join(':');
}

function getCachedElements(cacheKey) {
  const entry = responseCache.get(cacheKey);
  if (!entry) return null;

  if (Date.now() > entry.expiresAt) {
    responseCache.delete(cacheKey);
    return null;
  }

  // Refresh recency order for simple LRU eviction
  responseCache.delete(cacheKey);
  responseCache.set(cacheKey, entry);
  return entry.elements;
}

function setCachedElements(cacheKey, elements) {
  if (responseCache.has(cacheKey)) {
    responseCache.delete(cacheKey);
  } else if (responseCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = responseCache.keys().next().value;
    if (oldestKey !== undefined) {
      responseCache.delete(oldestKey);
    }
  }

  responseCache.set(cacheKey, {
    elements,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

async function queryOverpassEndpoint(url, query, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=UTF-8',
        'User-Agent': 'BubblrApp/1.0 (https://bubblrapp.com; hello@bubblrapp.com)',
      },
      body: query,
      signal: controller.signal,
    });

    if (!response.ok) {
      const err = new Error(`Overpass API responded with status ${response.status}`);
      err.statusCode = 502;
      err.upstreamStatus = response.status;
      throw err;
    }

    const rawText = await response.text();
    let data;
    try {
      data = JSON.parse(rawText);
    } catch {
      const err = new Error('Overpass API returned non-JSON response');
      err.statusCode = 502;
      throw err;
    }

    return Array.isArray(data?.elements) ? data.elements : [];
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutErr = new Error('Upstream fountain query timed out');
      timeoutErr.statusCode = 504;
      timeoutErr.cause = error;
      throw timeoutErr;
    }
    if (!error.statusCode) {
      error.statusCode = 500;
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchWithMirrorFallback(minLat, minLon, maxLat, maxLon) {
  const query = `
    [out:json][timeout:9];
    node[amenity=drinking_water](${minLat},${minLon},${maxLat},${maxLon});
    out body;
  `;

  const [primaryUrl, fallbackUrl] = OVERPASS_ENDPOINTS;

  try {
    const elements = await queryOverpassEndpoint(primaryUrl, query, PRIMARY_TIMEOUT_MS);
    return { elements, source: 'primary' };
  } catch (primaryError) {
    console.warn(`Primary Overpass (${primaryUrl}) failed:`, primaryError.message);

    if (!fallbackUrl) {
      throw primaryError;
    }

    try {
      const elements = await queryOverpassEndpoint(fallbackUrl, query, FALLBACK_TIMEOUT_MS);
      return { elements, source: 'mirror' };
    } catch (fallbackError) {
      console.error(`Fallback Overpass (${fallbackUrl}) failed:`, fallbackError.message);
      throw fallbackError;
    }
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: JSON_HEADERS,
      body: '',
    };
  }

  if (event.httpMethod !== 'POST' || !event.body) {
    return jsonResponse(405, {
      error: 'Method Not Allowed or missing request body',
      elements: [],
    });
  }

  let bounds;
  try {
    bounds = JSON.parse(event.body);
  } catch {
    return jsonResponse(400, {
      error: 'Invalid JSON request body',
      elements: [],
    });
  }

  const { minLat, minLon, maxLat, maxLon } = bounds || {};
  const hasValidBounds = [minLat, minLon, maxLat, maxLon].every(
    (val) => typeof val === 'number' && Number.isFinite(val)
  );

  if (!hasValidBounds) {
    return jsonResponse(400, {
      error: 'Missing or invalid bounding box coordinates (minLat, minLon, maxLat, maxLon)',
      elements: [],
    });
  }

  const cacheKey = buildCacheKey(minLat, minLon, maxLat, maxLon);
  const cached = getCachedElements(cacheKey);
  if (cached) {
    return jsonResponse(200, { elements: cached }, { 'X-Bubblr-Cache': 'HIT' });
  }

  let pending = inFlightRequests.get(cacheKey);
  if (!pending) {
    pending = fetchWithMirrorFallback(minLat, minLon, maxLat, maxLon)
      .then(({ elements, source }) => {
        setCachedElements(cacheKey, elements);
        return { elements, source };
      })
      .finally(() => {
        inFlightRequests.delete(cacheKey);
      });

    inFlightRequests.set(cacheKey, pending);
  }

  try {
    const { elements, source } = await pending;
    return jsonResponse(
      200,
      { elements },
      { 'X-Bubblr-Cache': 'MISS', 'X-Bubblr-Upstream': source }
    );
  } catch (error) {
    const statusCode = error?.statusCode || 500;
    const message =
      statusCode === 504
        ? 'Upstream fountain query timed out'
        : statusCode === 502
          ? error.message || 'Overpass API returned an invalid response'
          : 'Failed to fetch fountain data';

    return jsonResponse(statusCode, {
      error: message,
      elements: [],
    });
  }
};