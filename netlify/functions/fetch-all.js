// netlify/functions/fetch-osm.js

const OVERPASS_API_URL = 'https://overpass-api.de/api/interpreter';

exports.handler = async (event, context) => {
    // 1. Get the map bounds from the client's request body
    if (event.httpMethod !== 'POST' || !event.body) {
        return { statusCode: 405, body: 'Method Not Allowed or missing data' };
    }
    
    // The client sends bounds as a JSON string: {minLat, minLon, maxLat, maxLon}
    const { minLat, minLon, maxLat, maxLon } = JSON.parse(event.body);

    // 2. CONSTRUCT THE OBSCURED OVERPASS QUERY
    const query = `
        [out:json][timeout:15];
        // The specific query is hidden on the server
        node[amenity=drinking_water](${minLat},${minLon},${maxLat},${maxLon});
        out body;
    `;

    try {
        // 3. Send the request to the third-party API
        const response = await fetch(OVERPASS_API_URL, {
            method: 'POST',
            body: query
        });

        if (!response.ok) {
            throw new Error(`Overpass API failed: ${response.statusText}`);
        }

        const data = await response.json();

        // 4. Return the data to the client
        return {
            statusCode: 200,
            headers: {
                "Content-Type": "application/json", 
                "Access-Control-Allow-Origin": "*", 
            },
            body: JSON.stringify(data),
        };

    } catch (error) {
        console.error('OSM Proxy Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Failed to fetch external OSM data' }),
        };
    }
};