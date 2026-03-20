const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const TRUST_SSO_HEADER = (process.env.TRUST_SSO_HEADER || 'true') === 'true';
const METADATA_URL = process.env.METADATA_URL || 'http://metadata:9090';

const users = [
  { id: 1, email: 'analyst@acme.local', password: 'Winter2026!', role: 'analyst', displayName: 'Casey Analyst' },
  { id: 2, email: 'admin@acme.local', password: 'AdminPass2026!', role: 'admin', displayName: 'Riley Admin' }
];

const assets = [
  { id: 'LT-1042', owner: 'alex.smith', hostname: 'acme-lt-1042', type: 'laptop', location: 'NYC-14F' },
  { id: 'SRV-2241', owner: 'platform-team', hostname: 'acme-payments-01', type: 'server', location: 'IAD-AZ2' },
  { id: 'SRV-2242', owner: 'security-team', hostname: 'acme-vault-cache-01', type: 'server', location: 'IAD-AZ2' },
  { id: 'LT-2091', owner: 'jamie.lee', hostname: 'acme-lt-2091', type: 'laptop', location: 'Remote-US' }
];

const auditEvents = [
  { ts: '2026-03-15T08:14:22Z', event: 'sso_enabled', actor: 'deploy-bot', details: 'TRUST_SSO_HEADER=true set for new proxy rollout' },
  { ts: '2026-03-16T21:03:41Z', event: 'admin_webhook_test', actor: 'admin@acme.local', details: 'POST /api/admin/integrations/test target=https://hooks.slack.com/services/example' }
];

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error('body too large'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error('invalid json'));
      }
    });
    req.on('error', reject);
  });
}

function json(res, status, payload, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(payload));
}

function html(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(payload);
}

function parseCookies(req) {
  const raw = req.headers.cookie || '';
  const out = {};
  raw.split(';').forEach(part => {
    const idx = part.indexOf('=');
    if (idx > -1) {
      const key = part.slice(0, idx).trim();
      const value = part.slice(idx + 1).trim();
      out[key] = decodeURIComponent(value);
    }
  });
  return out;
}

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function signToken(payload) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const body = { ...payload, iss: 'acme-asset-portal', exp: Math.floor(Date.now() / 1000) + (4 * 60 * 60) };
  const encodedHeader = base64url(JSON.stringify(header));
  const encodedBody = base64url(JSON.stringify(body));
  const data = `${encodedHeader}.${encodedBody}`;
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(data).digest('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${data}.${sig}`;
}

function verifyToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('invalid token');
  const [header, payload, signature] = parts;
  const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  if (signature !== expected) throw new Error('bad signature');
  const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  if (parsed.exp && parsed.exp < Math.floor(Date.now() / 1000)) throw new Error('expired');
  return parsed;
}

function getAuthUser(req) {
  const cookies = parseCookies(req);
  const authz = req.headers.authorization || '';
  const bearer = authz.startsWith('Bearer ') ? authz.slice(7) : '';
  const token = cookies.session || bearer;

  if (token) {
    try {
      return verifyToken(token);
    } catch (err) {
      // continue to vulnerable header fallback
    }
  }

  if (TRUST_SSO_HEADER && req.headers['x-forwarded-user']) {
    const forwardedUser = String(req.headers['x-forwarded-user']).toLowerCase();
    const role = String(req.headers['x-forwarded-role'] || 'analyst').toLowerCase();
    return {
      email: forwardedUser,
      role,
      name: forwardedUser.split('@')[0],
      via: 'sso-header'
    };
  }

  return null;
}

function requireAuth(req, res) {
  const user = getAuthUser(req);
  if (!user) {
    json(res, 401, { error: 'authentication required' });
    return null;
  }
  return user;
}

function requireAdmin(req, res) {
  const user = requireAuth(req, res);
  if (!user) return null;
  if (user.role !== 'admin') {
    json(res, 403, { error: 'admin required' });
    return null;
  }
  return user;
}

function httpRequest(targetUrl, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(targetUrl);
    const client = urlObj.protocol === 'https:' ? require('https') : require('http');
    const req = client.request(urlObj, options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, statusText: res.statusMessage, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && urlObj.pathname === '/') {
    html(res, 200, `
      <html>
        <head><title>Acme Internal Asset Portal</title></head>
        <body style="font-family: Arial; max-width: 800px; margin: 40px auto;">
          <h1>Acme Internal Asset Portal</h1>
          <p>Internal inventory and diagnostics portal for enterprise IT.</p>
          <h2>Endpoints</h2>
          <ul>
            <li>POST /api/login</li>
            <li>GET /api/me</li>
            <li>GET /api/assets</li>
            <li>GET /api/admin/audit</li>
            <li>POST /api/admin/integrations/test</li>
          </ul>
          <p>Use curl or your preferred API client for testing.</p>
        </body>
      </html>
    `);
    return;
  }

  if (req.method === 'POST' && urlObj.pathname === '/api/login') {
    try {
      const { email, password } = await parseJsonBody(req);
      const user = users.find(u => u.email.toLowerCase() === String(email || '').toLowerCase());
      if (!user || user.password !== String(password || '')) {
        json(res, 401, { error: 'invalid credentials' });
        return;
      }
      const token = signToken({ sub: user.id, email: user.email, role: user.role, name: user.displayName });
      json(res, 200, { message: 'logged in', token, role: user.role, email: user.email }, {
        'Set-Cookie': `session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/`
      });
    } catch (err) {
      json(res, 400, { error: err.message });
    }
    return;
  }

  if (req.method === 'GET' && urlObj.pathname === '/api/me') {
    const user = requireAuth(req, res);
    if (!user) return;
    json(res, 200, { user });
    return;
  }

  if (req.method === 'GET' && urlObj.pathname === '/api/assets') {
    const user = requireAuth(req, res);
    if (!user) return;
    json(res, 200, { assets, count: assets.length, viewer: user.email });
    return;
  }

  if (req.method === 'GET' && urlObj.pathname === '/api/admin/audit') {
    const user = requireAdmin(req, res);
    if (!user) return;
    json(res, 200, { events: auditEvents, viewedBy: user.email, accessPath: user.via || 'jwt' });
    return;
  }

  if (req.method === 'GET' && urlObj.pathname === '/api/admin/healthcheck/dependencies') {
    const user = requireAdmin(req, res);
    if (!user) return;
    try {
      const upstream = await httpRequest(`${METADATA_URL}/latest/health`);
      json(res, 200, { ok: true, dependencies: JSON.parse(upstream.body) });
    } catch (err) {
      json(res, 500, { ok: false, error: err.message });
    }
    return;
  }

  if (req.method === 'POST' && urlObj.pathname === '/api/admin/integrations/test') {
    const user = requireAdmin(req, res);
    if (!user) return;

    try {
      const { url, method = 'GET', body } = await parseJsonBody(req);
      if (!url || typeof url !== 'string') {
        json(res, 400, { error: 'url required' });
        return;
      }

      const requestBody = method !== 'GET' ? JSON.stringify(body || {}) : null;
      const upstream = await httpRequest(url, {
        method,
        headers: {
          'User-Agent': 'acme-webhook-diagnostics/1.4',
          'Content-Type': 'application/json'
        }
      }, requestBody);

      json(res, 200, {
        ok: upstream.status >= 200 && upstream.status < 300,
        status: upstream.status,
        statusText: upstream.statusText,
        preview: upstream.body.slice(0, 600)
      });
    } catch (err) {
      json(res, 502, { error: 'integration test failed', detail: err.message });
    }
    return;
  }

  json(res, 404, { error: 'not found' });
});

server.listen(PORT, () => {
  console.log(`Acme Internal Asset Portal listening on ${PORT}`);
});
