// netlify/functions/fetch-locations.js

// 🚨 STEP 1: PASTE YOUR SECRET CSV URL HERE 
// This file executes on the server and is never exposed to the user's browser.
const SECRET_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSOhcn-9Ugls8T6z7fVQC6zV6Oc6-TGweMm0uX2hvGyvr6VFPdyvfUUfOugiUmqAQDgf11V_jnMgggu/pub?gid=2093128535&single=true&output=csv'; 

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