import { createHash, randomUUID } from "node:crypto";
import { database } from "../store";
import type { Job } from "../../lib/automation";
type Table =
  | "agents"
  | "schedules"
  | "judge_reviews"
  | "batches"
  | "automation_meta"
  | "automation_events";
export function getDoc<T>(table: Table, id: string): T | undefined {
  const row = database()
    .prepare(`SELECT body FROM ${table} WHERE id=?`)
    .get(id) as { body: string } | undefined;
  return row ? JSON.parse(row.body) : undefined;
}
export function docs<T>(table: Table): T[] {
  return (
    database()
      .prepare(`SELECT body FROM ${table} ORDER BY rowid DESC`)
      .all() as { body: string }[]
  ).map((r) => JSON.parse(r.body));
}
export function putDoc(table: Table, id: string, value: unknown) {
  database()
    .prepare(
      `INSERT INTO ${table}(id,body) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body`,
    )
    .run(id, JSON.stringify(value));
}
export function jobs(): Job[] {
  return (
    database().prepare("SELECT body FROM jobs ORDER BY rowid DESC").all() as {
      body: string;
    }[]
  ).map((r) => JSON.parse(r.body));
}
export function job(id: string): Job | undefined {
  const row = database().prepare("SELECT body FROM jobs WHERE id=?").get(id) as
    { body: string } | undefined;
  return row ? JSON.parse(row.body) : undefined;
}
export function putJob(value: Job) {
  database()
    .prepare(
      "INSERT INTO jobs(id,status,role,agent_id,company_id,search_id,due_at,body) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,due_at=excluded.due_at,body=excluded.body",
    )
    .run(
      value.id,
      value.status,
      value.role,
      value.agentId,
      value.companyId ?? null,
      value.searchId ?? null,
      value.dueAt,
      JSON.stringify(value),
    );
}
export function hash(value: unknown): string {
  const canonical = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, x]) => [k, canonical(x)]),
          )
        : v;
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}
export function once<T>(
  actor: string,
  key: string,
  input: unknown,
  fn: () => T,
): T {
  if (!key || key.length > 200)
    throw new Error("An idempotency key is required (up to 200 characters).");
  return database().transaction(() => {
    const id = `${actor}:${key}`,
      fingerprint = hash(input);
    const prev = database()
      .prepare("SELECT hash,body FROM submissions WHERE id=?")
      .get(id) as { hash: string; body: string } | undefined;
    if (prev) {
      if (prev.hash !== fingerprint)
        throw new Error(
          "This idempotency key was already used with different input.",
        );
      return JSON.parse(prev.body) as T;
    }
    const result = fn();
    database()
      .prepare("INSERT INTO submissions(id,hash,body) VALUES(?,?,?)")
      .run(id, fingerprint, JSON.stringify(result));
    return result;
  })();
}
export function audit(actor: string, action: string, detail: string) {
  const id = randomUUID();
  putDoc("automation_events", id, {
    id,
    actor,
    action,
    detail,
    at: new Date().toISOString(),
  });
}
