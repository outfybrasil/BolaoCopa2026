// Cloudflare Worker — Proxy da football-data.org
// Faça deploy disso no Cloudflare Workers (https://workers.cloudflare.com)
// Após o deploy, pegue a URL (ex: https://meu-bolao.workers.dev)
// E atualize PRODUCTION_API_URL em app.js

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const apiPath = url.pathname.replace('/api/', '');
    const apiUrl = 'https://api.football-data.org/v4/' + apiPath + url.search;

    const headers = new Headers({
      'X-Auth-Token': '4978542601fd48d69a3d9db90d3ef518'
    });

    const res = await fetch(apiUrl, { headers });
    const cors = new Headers(res.headers);
    cors.set('Access-Control-Allow-Origin', '*');

    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: cors
    });
  }
};
