// netlify/functions/fetch-all.js

const OVERPASS_ENDPOINTS = [
    'https://overpass.kumi.systems/api/interpreter',          // Primary community mirror
    'https://overpass.openstreetmap.fr/api/interpreter',     // French OpenStreetMap community mirror
    'https://api.openstreetmap.fr/oapi/interpreter'          // Secondary French mirror
];

exports.handler = async (event, context) => {
    // 1. Get the map bounds from the client's request body
    if (event.httpMethod !== 'POST' || !event.body) {
        return { statusCode: 405, body: 'Method Not Allowed or missing data' };
    }
    
    // The client sends bounds as a JSON string: {minLat, minLon, maxLat, maxLon}
    const { minLat, minLon, maxLat, maxLon } = JSON.parse(event.body);

    // 2. CONSTRUCT THE OVERPASS QUERY
    const query = `
        [out:json][timeout:10];
        node[amenity=drinking_water](${minLat},${minLon},${maxLat},${maxLon});
        out body;
    `;

    let data = null;
    let lastError = null;

    // 3. Loop through trusted endpoints until one succeeds
    for (const endpoint of OVERPASS_ENDPOINTS) {
        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'User-Agent': 'BubblrApp/1.0 (https://bubblrapp.com; hello@bubblrapp.com)'
                },
                body: query
            });

            if (!response.ok) {
                throw new Error(`Endpoint HTTP error: ${response.status}`);
            }

            // Ensure we got actual JSON back instead of an HTML gateway error page
            const contentType = response.headers.get("content-type");
            if (!contentType || !contentType.includes("application/json")) {
                throw new Error("Received non-JSON response (likely gateway HTML timeout)");
            }

            data = await response.json();
            break; // Success! Exit the loop
        } catch (error) {
            lastError = error.message;
            console.warn(`Attempt failed on ${endpoint}: ${error.message}`);
        }
    }

    // 4. Handle total failure if all mirrors fail
    if (!data) {
        console.error('All OSM Proxy Endpoints Failed:', lastError);
        return {
            statusCode: 502,
            body: JSON.stringify({ error: 'Failed to fetch external OSM data from all available mirrors', details: lastError }),
        };
    }

    // 5. Return the valid data to the client
    return {
        statusCode: 200,
        headers: {
            "Content-Type": "application/json", 
            "Access-Control-Allow-Origin": "*", 
        },
        body: JSON.stringify(data),
    };
}; // <--- THIS CLOSING BRACE WAS MISSING