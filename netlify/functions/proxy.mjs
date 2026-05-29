// Netlify Function — Proxy da football-data.org
// Deploy automático via Git (não precisa configurar nada)

const API_KEY = '4978542601fd48d69a3d9db90d3ef518';

export const handler = async (event) => {
  const path = event.queryStringParameters.path || '';
  const apiUrl = 'https://api.football-data.org/v4/' + path;

  try {
    const res = await fetch(apiUrl, {
      headers: { 'X-Auth-Token': API_KEY }
    });

    const body = await res.text();

    return {
      statusCode: res.status,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': res.headers.get('content-type') || 'application/json'
      },
      body
    };
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: e.message })
    };
  }
};
