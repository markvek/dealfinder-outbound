import { randomBytes, randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { database } from "../store";
import { guardLocalRequest } from "../request";
import { audit, getDoc } from "./repository";
import type { ApiKeyInfo, Agent, Scope } from "../../lib/automation";
export interface Actor {
  id: string;
  browser: boolean;
  scopes: Scope[];
  agentIds: string[];
}
export class ApiError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
export function authenticate(request: Request): Actor {
  const bearer = request.headers.get("authorization");
  if (!bearer) {
    guardLocalRequest(request);
    return {
      id: "browser",
      browser: true,
      scopes: ["read", "searches", "jobs", "schedules"],
      agentIds: [],
    };
  }
  const url = new URL(request.url);
  const host = new URL(
    `${url.protocol}//${request.headers.get("host") ?? url.host}`,
  );
  if (!["localhost", "127.0.0.1", "[::1]"].includes(host.hostname))
    throw new ApiError("This deployment accepts local connections only.", 403);
  if (
    request.headers.get("origin") ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    throw new ApiError("Use browser session access in the web interface.", 403);
  if (!/^Bearer df_[a-f0-9]{64}$/.test(bearer))
    throw new ApiError("Invalid API key.", 401);
  const hash = createHash("sha256").update(bearer.slice(7)).digest("hex");
  const row = database()
    .prepare("SELECT body FROM api_keys WHERE token_hash=?")
    .get(hash) as { body: string } | undefined;
  const key: ApiKeyInfo | undefined = row ? JSON.parse(row.body) : undefined;
  if (!key || key.revokedAt || Date.parse(key.expiresAt) <= Date.now())
    throw new ApiError("API key is expired or revoked.", 401);
  key.lastUsedAt = new Date().toISOString();
  database()
    .prepare("UPDATE api_keys SET body=? WHERE id=?")
    .run(JSON.stringify(key), key.id);
  return {
    id: key.id,
    browser: false,
    scopes: key.scopes,
    agentIds: key.agentIds,
  };
}
export function requireScope(actor: Actor, scope: Scope) {
  if (!actor.browser && !actor.scopes.includes(scope))
    throw new ApiError(`Missing permission: ${scope}`, 403);
}
export function requireOwner(actor: Actor) {
  if (!actor.browser)
    throw new ApiError(
      "This action requires the owner’s browser session.",
      403,
    );
}
export function listKeys(): ApiKeyInfo[] {
  return (
    database()
      .prepare("SELECT body FROM api_keys ORDER BY rowid DESC")
      .all() as { body: string }[]
  ).map((r) => JSON.parse(r.body));
}
export const keySchema = z.object({
  name: z.string().trim().min(1).max(100),
  days: z.number().int().min(1).max(365).default(90),
  scopes: z
    .array(z.enum(["read", "searches", "jobs", "schedules", "execute"]))
    .min(1),
  agentIds: z.array(z.string()).default([]),
});
export function createKey(actor: Actor, input: unknown) {
  requireOwner(actor);
  const value = keySchema.parse(input);
  if (value.scopes.includes("execute") && !value.agentIds.length)
    throw new ApiError("Bind executor access to at least one external agent.");
  for (const id of value.agentIds) {
    const a = getDoc<Agent>("agents", id);
    if (!a || a.adapter !== "external")
      throw new ApiError("Executor keys must be bound to external agents.");
  }
  const token = `df_${randomBytes(32).toString("hex")}`,
    id = randomUUID();
  const key: ApiKeyInfo = {
    id,
    name: value.name,
    prefix: token.slice(0, 11),
    scopes: value.scopes,
    agentIds: value.agentIds,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + value.days * 86400000).toISOString(),
    revokedAt: null,
    lastUsedAt: null,
  };
  database()
    .prepare("INSERT INTO api_keys(id,token_hash,body) VALUES(?,?,?)")
    .run(
      id,
      createHash("sha256").update(token).digest("hex"),
      JSON.stringify(key),
    );
  audit(actor.id, "key.created", id);
  return { token, key };
}
export function revokeKey(actor: Actor, id: string) {
  requireOwner(actor);
  const key = listKeys().find((k) => k.id === id);
  if (!key) throw new ApiError("Key not found.", 404);
  key.revokedAt = new Date().toISOString();
  database()
    .prepare("UPDATE api_keys SET body=? WHERE id=?")
    .run(JSON.stringify(key), id);
  audit(actor.id, "key.revoked", id);
  return { revoked: true };
}
