export function guardLocalRequest(request: Request) {
  // Next may normalize request.url to localhost. Validate the original Host
  // header so localhost and 127.0.0.1 each retain their actual browser origin.
  const url = new URL(request.url);
  const authority = request.headers.get("host") ?? url.host;
  const target = new URL(`${url.protocol}//${authority}`);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)) {
    throw new Error("This local workspace only accepts localhost requests.");
  }
  if (request.headers.has("authorization"))
    throw new Error("Use the automation API for API keys.");
  if (
    !["GET", "HEAD"].includes(request.method) &&
    !request.headers.get("origin")
  )
    throw new Error("A same-origin browser request is required.");
  const origin = request.headers.get("origin");
  if (origin && origin !== target.origin)
    throw new Error("Cross-origin requests are not allowed.");
  if (request.headers.get("sec-fetch-site") === "cross-site")
    throw new Error("Cross-site requests are not allowed.");
}
