import "dotenv/config";

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { createPostgresPool, type Db } from "../server/src/db/client.js";

// The dashboard shares database `fasola` with fasola-order-bot, and the same
// DATABASE_URL shape is used on the production VM. These scripts drop and
// rewrite data, so they refuse to run anywhere but a local Postgres — a stray
// `.env` pointing at the VM must never be reset by a dev-loop command.
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export const DEFAULT_DATABASE_URL = "postgres://postgres@localhost:5432/fasola";

export interface DatabaseTarget {
  url: string;
  database: string;
  host: string;
  label: string;
}

export function resolveTarget(env: NodeJS.ProcessEnv = process.env): DatabaseTarget {
  const url = env.DATABASE_URL ?? DEFAULT_DATABASE_URL;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`DATABASE_URL is not a valid connection string: ${url}`);
  }

  if (!/^postgres(ql)?:$/.test(parsed.protocol)) {
    throw new Error(
      `DATABASE_URL must be a postgres:// connection string, got ${parsed.protocol}//`
    );
  }

  const host = parsed.hostname;

  if (!LOCAL_HOSTNAMES.has(host)) {
    throw new Error(
      [
        `Refusing to run against a non-local database: host "${host}".`,
        "",
        "These scripts DESTROY data and are only ever meant for a local dev",
        "database. If you really need to reseed a remote host, do it there by",
        "hand — deliberately, and with a backup.",
        "",
        `  DATABASE_URL = ${redact(url)}`
      ].join("\n")
    );
  }

  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));

  if (!database) {
    throw new Error(`DATABASE_URL has no database name: ${redact(url)}`);
  }

  return {
    url,
    database,
    host,
    label: `${database} @ ${host}:${parsed.port || "5432"}`
  };
}

export function connect(target: DatabaseTarget): Db {
  return createPostgresPool(target.url);
}

// --force / --yes / -y skip the prompt for scripted runs. Without a TTY we
// refuse rather than silently proceeding, so a CI or hook invocation can't wipe
// a database just because nobody was there to say no.
export function hasForceFlag(argv: readonly string[] = process.argv.slice(2)): boolean {
  return argv.some((arg) => arg === "--force" || arg === "--yes" || arg === "-y");
}

export async function confirm(question: string, force: boolean): Promise<boolean> {
  if (force) {
    return true;
  }

  if (!stdin.isTTY) {
    console.error("Not a TTY and --force was not passed — refusing to continue.");
    return false;
  }

  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await rl.question(`${question} [y/N] `);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

export function redact(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      parsed.password = "***";
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

// Scripts are top-level awaited; surface a clean message instead of a stack.
export function fail(error: unknown): never {
  console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
