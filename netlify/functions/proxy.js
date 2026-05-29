// Netlify Function — Proxy da football-data.org
const https = require('https');

const API_KEY = '4978542601fd48d69a3d9db90d3ef518';

exports.handler = async (event, context) => {
  const path = event.queryStringParameters.path || '';
  const apiUrl = '/v4/' + path;

  return new Promise((resolve) => {
    const options = {
      hostname: 'api.football-data.org',
      port: 443,
      path: apiUrl,
      method: 'GET',
      headers: { 'X-Auth-Token': API_KEY }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': res.headers['content-type'] || 'application/json'
          },
          body
        });
      });
    });

    req.on('error', (e) => {
      resolve({
        statusCode: 500,
        body: JSON.stringify({ error: e.message })
      });
    });

    req.end();
  });
};
