import { setTimeout as sleep } from 'node:timers/promises';

export class ApiError extends Error {
  constructor(service, status) {
    const hint = { 401: 'Check the API credential.', 403: 'Check connection permissions.',
      404: 'Check the model or Notion page ID and page sharing.', 429: 'Rate limit or API quota reached.' }[status];
    super(`${service} returned HTTP ${status}. ${hint || 'Check request configuration and service availability.'}`);
    this.status = status;
  }
}

// Never log response bodies: providers may echo research text or credentials.
// Retrying ambiguous writes could create duplicate pages or duplicate AI charges.
export async function request(url, { service, headers, body, method = 'GET', retrySafe = false,
  fetchImpl = fetch, wait = sleep, timeout = 180_000 } = {}) {
  for (let attempt = 0; ; attempt++) {
    let response;
    try {
      response = await fetchImpl(url, { method, headers: { 'Content-Type': 'application/json', ...headers },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
    } catch {
      if (retrySafe && attempt < 2) { await wait(1000 * 2 ** attempt); continue; }
      throw new Error(`${service} connection timed out or failed. Check internet access; the next run will reconcile saved progress.`);
    }
    if (response.ok) return response.json();
    if (attempt < 2 && (response.status === 429 || (retrySafe && response.status >= 500))) {
      const seconds = Number(response.headers.get('retry-after'));
      await wait(Math.min(60_000, Math.max(1000 * 2 ** attempt, Number.isFinite(seconds) ? seconds * 1000 : 0)));
      continue;
    }
    throw new ApiError(service, response.status);
  }
}
