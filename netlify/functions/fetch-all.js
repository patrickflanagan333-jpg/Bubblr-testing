// netlify/functions/fetch-all.js

const OVERPASS_API_URL = 'https://overpass-api.de/api/interpreter';
const UPSTREAM_TIMEOUT_MS = 11000;

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  };
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

  const query = `
    [out:json][timeout:10];
    node[amenity=drinking_water](${minLat},${minLon},${maxLat},${maxLon});
    out body;
  `;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const response = await fetch(OVERPASS_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=UTF-8',
        'User-Agent': 'BubblrApp/1.0 (https://bubblrapp.com; hello@bubblrapp.com)',
      },
      body: query,
      signal: controller.signal,
    });

    if (!response.ok) {
      return jsonResponse(502, {
        error: `Overpass API responded with status ${response.status}`,
        elements: [],
      });
    }

    const rawText = await response.text();
    let data;
    try {
      data = JSON.parse(rawText);
    } catch {
      return jsonResponse(502, {
        error: 'Overpass API returned non-JSON response',
        elements: [],
      });
    }

    const elements = Array.isArray(data?.elements) ? data.elements : [];

    return jsonResponse(200, {
      elements,
    });
  } catch (error) {
    const isTimeout = error?.name === 'AbortError';
    console.error('fetch-all function error:', error);

    return jsonResponse(isTimeout ? 504 : 500, {
      error: isTimeout
        ? 'Upstream fountain query timed out'
        : 'Failed to fetch fountain data',
      elements: [],
    });
  } finally {
    clearTimeout(timeoutId);
  }
};