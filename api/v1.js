const UPSTREAM_BASE = 'https://ai.hackclub.com/proxy/v1';

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Accept, Origin, X-Requested-With');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const upstreamPath = (req.url || '').replace(/^\/api\/v1\/?/, '');
  const upstreamUrl = `${UPSTREAM_BASE}/${upstreamPath}`.replace(/([^:])\/\//g, '$1/');

  const headers = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (!value) continue;
    const lower = key.toLowerCase();
    if (['host', 'content-length', 'connection', 'origin'].includes(lower)) continue;
    headers[key] = value;
  }

  const fetchOptions = { method: req.method, headers };
  if (!['GET', 'HEAD'].includes(req.method)) {
    fetchOptions.body = await readBody(req);
  }

  const upstream = await fetch(upstreamUrl, fetchOptions);

  const skipHeaders = new Set([
    'content-encoding', 'content-length', 'transfer-encoding',
    'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
    'te', 'trailer', 'upgrade',
  ]);

  for (const [key, value] of upstream.headers.entries()) {
    if (!skipHeaders.has(key.toLowerCase())) {
      res.setHeader(key, value);
    }
  }

  res.status(upstream.status);
  const buffer = Buffer.from(await upstream.arrayBuffer());
  res.end(buffer);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
