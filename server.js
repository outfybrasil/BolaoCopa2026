const http = require('http');
const fs = require('fs');
const path = require('path');
const https = require('https');

const API_KEY = '4978542601fd48d69a3d9db90d3ef518';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.json': 'application/json',
  '.ico':  'image/x-icon',
};

const server = http.createServer((req, res) => {
  // ========== PROXY: /api/* → api.football-data.org ==========
  if (req.url.startsWith('/api/')) {
    const apiPath = req.url.slice(4);
    const options = {
      hostname: 'api.football-data.org',
      port: 443,
      path: apiPath,
      method: 'GET',
      headers: { 'X-Auth-Token': API_KEY }
    };

    const proxyReq = https.request(options, (proxyRes) => {
      const headers = { ...proxyRes.headers, 'Access-Control-Allow-Origin': '*' };
      res.writeHead(proxyRes.statusCode, headers);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (e) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    });

    proxyReq.end();
    return;
  }

  // ========== ARQUIVOS ESTÁTICOS ==========
  // Segurança: impede acesso a arquivos fora da pasta do projeto
  const requestedPath = req.url === '/' ? 'bolao_copa_2026.html' : req.url;
  const safePath = path.normalize(requestedPath).replace(/^(\.\.(\/|\\|$))+/, '');
  const filePath = path.join(__dirname, safePath);

  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end('Acesso negado');
    return;
  }

  const ext = path.extname(filePath);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 - Arquivo não encontrado');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

// Tenta porta 8080, se ocupada tenta 8081, 8082...
function tryPort(port) {
  server.listen(port, '0.0.0.0', () => {
    console.log(`✅ Servidor rodando! Acesse:`);
    console.log(`   http://localhost:${port}`);
    console.log(`   http://127.0.0.1:${port}`);
    console.log(`\n📌 Mantenha este terminal aberto.`);
    console.log(`   Para parar: Ctrl+C`);
  });

  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      if (port < 8090) tryPort(port + 1);
      else console.error('❌ Todas as portas 8080-8090 ocupadas');
    } else {
      console.error('❌ Erro ao iniciar servidor:', e.message);
    }
  });
}

tryPort(3000);
