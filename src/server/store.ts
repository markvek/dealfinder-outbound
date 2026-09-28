import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { simplifyExamples } from "./migrations/examples";
import { createSeed } from "../lib/seed";
import type { Workspace } from "../lib/types";
import { transition, type Action, WorkflowError } from "./workflow";

let db: Database.Database | undefined;
export function database() {
  if (!db) {
    const path = resolve(
      /* turbopackIgnore: true */
      process.env.DEALFINDER_DB_PATH || ".data/dealfinder.sqlite",
    );
    mkdirSync(dirname(path), { recursive: true });
    db = new Database(path);
    db.pragma("journal_mode = WAL");
    db.pragma("busy_timeout = 5000");
    db.exec(
      "CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK (id = 1), body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS revisions (version INTEGER PRIMARY KEY, body TEXT NOT NULL, created_at TEXT NOT NULL)",
    );
    db.prepare("INSERT OR IGNORE INTO workspace (id, body) VALUES (1, ?)").run(
      JSON.stringify(createSeed()),
    );
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS agents (id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS schedules (id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, status TEXT NOT NULL, role TEXT NOT NULL, agent_id TEXT NOT NULL, company_id TEXT, search_id TEXT, due_at TEXT NOT NULL, body TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS jobs_queue ON jobs(status, due_at);
      CREATE TABLE IF NOT EXISTS judge_reviews (id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS batches (id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS automation_meta (id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS api_keys (id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS automation_events (id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS submissions (id TEXT PRIMARY KEY, hash TEXT NOT NULL, body TEXT NOT NULL);
    `);
    const conn = db;
    conn.transaction(() => {
      if (
        !conn
          .prepare("SELECT id FROM schema_migrations WHERE id=?")
          .get("one-example-v1")
      ) {
        const current = JSON.parse(
          (
            conn.prepare("SELECT body FROM workspace WHERE id=1").get() as {
              body: string;
            }
          ).body,
        ) as Workspace;
        const updated = simplifyExamples(current);
        if (JSON.stringify(current) !== JSON.stringify(updated)) {
          conn
            .prepare(
              "INSERT OR IGNORE INTO revisions(version,body,created_at) VALUES(?,?,?)",
            )
            .run(
              current.version,
              JSON.stringify(current),
              new Date().toISOString(),
            );
          updated.version++;
          conn
            .prepare("UPDATE workspace SET body=? WHERE id=1")
            .run(JSON.stringify(updated));
        }
        conn
          .prepare("INSERT INTO schema_migrations(id) VALUES(?)")
          .run("one-example-v1");
      }
    })();
  }
  return db;
}
export function readWorkspace(): Workspace {
  const row = database()
    .prepare("SELECT body FROM workspace WHERE id = 1")
    .get() as { body: string };
  return JSON.parse(row.body);
}
export function mutateWorkspace(version: number, action: Action): Workspace {
  return database().transaction(() => {
    const current = readWorkspace();
    if (current.version !== version)
      throw new WorkflowError(
        "The workspace changed in another tab. Refresh and try again.",
      );
    const updated = transition(current, action);
    database()
      .prepare(
        "INSERT OR IGNORE INTO revisions (version, body, created_at) VALUES (?, ?, ?)",
      )
      .run(current.version, JSON.stringify(current), new Date().toISOString());
    database()
      .prepare("UPDATE workspace SET body = ? WHERE id = 1")
      .run(JSON.stringify(updated));
    return updated;
  })();
}

export function saveWorkspace(current: Workspace, updated: Workspace) {
  const conn = database();
  conn
    .prepare(
      "INSERT OR IGNORE INTO revisions(version,body,created_at) VALUES(?,?,?)",
    )
    .run(current.version, JSON.stringify(current), new Date().toISOString());
  updated.version = current.version + 1;
  conn
    .prepare("UPDATE workspace SET body=? WHERE id=1")
    .run(JSON.stringify(updated));
  return updated;
}
