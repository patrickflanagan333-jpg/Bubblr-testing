// netlify/functions/fetch-all.js

const OVERPASS_ENDPOINT = 'https://overpass.private.coffee/api/interpreter';

exports.handler = async (event, context) => {
    if (event.httpMethod !== 'POST' || !event.body) {
        return { 
            statusCode: 405, 
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ error: 'Method Not Allowed' }) 
        };
    }
    
    const { minLat, minLon, maxLat, maxLon } = JSON.parse(event.body);

    // Simplified query asking for just the primary drinking water tag
    const query = `
        [out:json][timeout:15];
        (
          node["amenity"="drinking_water"](${minLat},${minLon},${maxLat},${maxLon});
        );
        out body;
    `;

    try {
        const response = await fetch(OVERPASS_ENDPOINT, {
            method: 'POST',
            headers: { 'User-Agent': 'BubblrApp/1.0 (https://bubblrapp.com)' },
            body: query
        });

        if (!response.ok) {
            throw new Error(`Overpass API error: ${response.status}`);
        }

        const data = await response.json();

        return {
            statusCode: 200,
            headers: {
                "Content-Type": "application/json", 
                "Access-Control-Allow-Origin": "*", 
            },
            body: JSON.stringify(data),
        };

    } catch (error) {
        console.error('Fetch failed:', error.message);
        return {
            statusCode: 502,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ error: 'Failed to fetch external OSM data', details: error.message }),
        };
    }
};