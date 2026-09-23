// HTTP client for the Formlabs Local API. Long operations go through
// ?async=true and are polled at /operations/{id}/ until they settle.
export class PreFormError extends Error {
  constructor(status, code, message, body) {
    super(message);
    this.name = 'PreFormError';
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createClient(baseUrl = 'http://localhost:44388', { pollMs = 500, fetchImpl = fetch } = {}) {
  const base = baseUrl.replace(/\/$/, '');

  async function request(method, path, body, query) {
    const url = new URL(base + path);
    for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, String(v));
    const res = await fetchImpl(url, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : undefined; } catch { data = text; }
    if (!res.ok) {
      const err = data?.error ?? {};
      throw new PreFormError(res.status, err.code ?? `HTTP_${res.status}`, err.message ?? `${method} ${path} failed with ${res.status}`, data);
    }
    return { status: res.status, data };
  }

  async function waitOperation(id, onProgress) {
    for (;;) {
      const { data: op } = await request('GET', `/operations/${id}/`);
      onProgress?.(op);
      if (op.status === 'SUCCEEDED') return op.result;
      if (op.status === 'FAILED') {
        const err = op.result?.error ?? {};
        throw new PreFormError(500, err.code ?? 'OPERATION_FAILED', err.message ?? `operation ${id} failed`, op);
      }
      await sleep(pollMs);
    }
  }

  // run: the operation-aware call. wait:false hands back {operationId}.
  async function run(method, path, body, { wait = true, onProgress } = {}) {
    const { status, data } = await request(method, path, body, { async: true });
    if (status !== 202 || !data?.operationId) return data;
    if (!wait) return data;
    return waitOperation(data.operationId, onProgress);
  }

  return { base, request: async (m, p, b, q) => (await request(m, p, b, q)).data, run, waitOperation };
}
