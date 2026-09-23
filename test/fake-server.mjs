// Fake PreFormServer: records every request, answers from a route table.
import http from 'node:http';

export async function fakeServer(routes = {}) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const body = raw ? JSON.parse(raw) : undefined;
      calls.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body });
      const handler = routes[`${req.method} ${url.pathname}`];
      const [status, payload] = handler ? handler({ body, query: url.searchParams, calls }) : [404, { error: { code: 'NOT_FOUND', message: url.pathname } }];
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(payload === undefined ? '' : JSON.stringify(payload));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, calls, close: () => { server.closeAllConnections(); return new Promise((r) => server.close(r)); } };
}
