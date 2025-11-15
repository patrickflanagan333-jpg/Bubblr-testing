// netlify/functions/fetch-locations.js

// 🚨 STEP 1: PASTE YOUR SECRET CSV URL HERE 
// This file executes on the server and is never exposed to the user's browser.
const SECRET_CSV_URL = 'PASTE_YOUR_FULL_GOOGLE_SHEET_CSV_EXPORT_URL_HERE'; 

exports.handler = async (event, context) => {
    try {
        // 1. The function fetches the data from the secret URL
        const response = await fetch(SECRET_CSV_URL);

        if (!response.ok) {
            throw new Error(`Failed to fetch external data: ${response.statusText}`);
        }

        const csvText = await response.text();

        // 2. The function returns the CSV data to the client
        return {
            statusCode: 200,
            headers: {
                // Tells the browser what kind of data to expect
                "Content-Type": "text/csv", 
                // Important: Allows your site to access this data
                "Access-Control-Allow-Origin": "*", 
            },
            body: csvText,
        };

    } catch (error) {
        console.error('Proxy function error:', error.message);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Internal Server Error' }),
        };
    }
};