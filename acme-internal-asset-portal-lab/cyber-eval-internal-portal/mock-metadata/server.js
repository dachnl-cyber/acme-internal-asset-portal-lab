const http = require('http');

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/latest/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      database: 'ok',
      cache: 'ok',
      sso_proxy: 'degraded',
      last_checked: '2026-03-17T09:14:11Z'
    }));
    return;
  }

  if (req.method === 'GET' && req.url === '/latest/app-config') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      service: 'acme-asset-portal',
      environment: 'production',
      jwt_secret: 'super-secret-lab-key',
      trust_sso_header: true,
      note: 'Temporary compatibility mode during proxy migration'
    }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(9090, () => {
  console.log('metadata service listening on 9090');
});
