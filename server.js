const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DEFAULT_PORT = Number(process.env.PORT) || 8787;
const UPSTREAM_BASE = 'https://ai.hackclub.com/proxy/v1';

const COLORS = {
  reset: '\x1b[0m',
  gray: '\x1b[90m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

function colorText(color, text) {
  return `${color}${text}${COLORS.reset}`;
}

function logInfo(message) {
  console.log(colorText(COLORS.cyan, message));
}

function logDebug(message) {
  console.log(colorText(COLORS.gray, message));
}

function logSuccess(message) {
  console.log(colorText(COLORS.green, message));
}

function logWarn(message) {
  console.warn(colorText(COLORS.yellow, message));
}

function logError(message, error) {
  console.error(colorText(COLORS.red, message), error || '');
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function sendCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Accept, Origin, X-Requested-With');
  logDebug(`CORS headers sent for ${res.statusCode}`);
}

function getContentType(filePath) {
  const contentType = MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  logInfo(`Determined content type for ${filePath}: ${contentType}`);
  return contentType;
}

function serveFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      logError(`Error reading file ${filePath}:`, err);
      return;
    }
    res.writeHead(200, { 'Content-Type': getContentType(filePath) });
    res.end(data);
    logSuccess(`Served file: ${filePath}`);
  });
}

async function proxyRequest(req, res) {
  const upstreamPath = (req.url || '').replace(/^\/api\/v1/, '').replace(/^\/+/, '');
  const upstreamUrl = new URL(upstreamPath, `${UPSTREAM_BASE}/`);
  const headers = {};
  logInfo(`Proxying request to: ${upstreamUrl.href}`);

  for (const [key, value] of Object.entries(req.headers)) {
    if (!value) continue;
    const lower = key.toLowerCase();
    if (['host', 'content-length', 'connection', 'origin'].includes(lower)) continue;
    headers[key] = value;
    logDebug(`Forwarding header: ${key}: ${value}`);
  }

  const options = {
    method: req.method,
    headers,
    redirect: 'follow',
  };
  logInfo(`Request method: ${req.method}`);

  if (!['GET', 'HEAD'].includes(req.method)) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    options.body = Buffer.concat(chunks);
    logWarn(`Received request body of length: ${options.body.length}`);
  }

  const upstreamResponse = await fetch(upstreamUrl, options);
  const responseHeaders = {};
  logSuccess(`Received response with status: ${upstreamResponse.status}`);
  for (const [key, value] of upstreamResponse.headers.entries()) {
    const lower = key.toLowerCase();
    if (['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'upgrade'].includes(lower)) {
      continue;
    }
    responseHeaders[key] = value;
    logDebug(`Forwarding response header: ${key}: ${value}`);
  }
  res.writeHead(upstreamResponse.status, responseHeaders);
  const body = Buffer.from(await upstreamResponse.arrayBuffer());
  res.end(body);
  logSuccess(`Proxied response body of length: ${body.length}`);
}

const server = http.createServer(async (req, res) => {
  sendCors(res);
  logInfo(`Incoming request: ${req.method} ${req.url}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    logDebug('Handled preflight OPTIONS request');
    return;
  }

  if (req.url.startsWith('/api/v1')) {
    try {
      await proxyRequest(req, res);
      logSuccess('Successfully proxied API request');
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: { message: err.message || 'Proxy failed' } }));
      logError('Error proxying request:', err);
    }
    return;
  }

  const safePath = decodeURIComponent((req.url || '/').split('?')[0]);
  const normalized = safePath === '/' ? '/index.html' : safePath;
  const filePath = path.join(ROOT, normalized);
  logDebug(`Resolved file path: ${filePath}`);

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    logWarn(`Attempted directory traversal attack: ${filePath}`);
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      serveFile(res, path.join(ROOT, 'index.html'));
      logWarn(`File not found: ${filePath}, serving index.html instead`);
      return;
    }
    serveFile(res, filePath);
    logSuccess(`Serving file for request: ${filePath}`);
  });
});

function startServer(port) {
  server.listen(port, () => {
    logSuccess(`FuddiG AI local proxy running at http://localhost:${port}`);
  });
}

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    const nextPort = (server.address() && server.address().port ? server.address().port + 1 : DEFAULT_PORT + 1);
    if (nextPort <= DEFAULT_PORT + 10) {
      logWarn(`Port ${DEFAULT_PORT} is busy, trying ${nextPort}...`);
      startServer(nextPort);
      return;
    }
  }

  logError('Failed to start local proxy:', err);
  process.exit(1);
});

startServer(DEFAULT_PORT);