import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

let database: DatabaseSync | undefined;
export function db() {
  if (!database) {
    const path = process.env.DATABASE_PATH || join(process.cwd(), "data", "gold.sqlite");
    mkdirSync(dirname(path), { recursive: true });
    database = new DatabaseSync(path);
    database.exec(
      "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS records (collection TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(collection,id));",
    );
  }
  return database;
}
export function list<T>(collection: string): T[] {
  return (
    db()
      .prepare(
        "SELECT body FROM records WHERE collection=? ORDER BY rowid DESC",
      )
      .all(collection) as { body: string }[]
  ).map((row) => JSON.parse(row.body) as T);
}
export function get<T>(collection: string, id: string): T | null {
  const row = db()
    .prepare("SELECT body FROM records WHERE collection=? AND id=?")
    .get(collection, id) as { body: string } | undefined;
  return row ? (JSON.parse(row.body) as T) : null;
}
export function put(collection: string, id: string, value: unknown) {
  db()
    .prepare(
      "INSERT INTO records(collection,id,body) VALUES(?,?,?) ON CONFLICT(collection,id) DO UPDATE SET body=excluded.body",
    )
    .run(collection, id, JSON.stringify(value));
}
export function remove(collection: string, id: string) {
  return db()
    .prepare("DELETE FROM records WHERE collection=? AND id=?")
    .run(collection, id).changes;
}
export function atomic(action: () => void) {
  db().exec("BEGIN IMMEDIATE");
  try {
    action();
    db().exec("COMMIT");
  } catch (error) {
    db().exec("ROLLBACK");
    throw error;
  }
}
