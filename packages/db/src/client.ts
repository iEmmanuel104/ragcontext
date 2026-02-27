import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

export interface DbClientOptions {
  url: string;
  maxConnections?: number;
  minConnections?: number;
}

const DEFAULT_API_POOL = { max: 20, min: 2 };
const DEFAULT_WORKER_POOL = { max: 10, min: 1 };

export function createDbClient(options: DbClientOptions) {
  const connection = postgres(options.url, {
    max: options.maxConnections ?? DEFAULT_API_POOL.max,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  return drizzle(connection, { schema });
}

export function createWorkerDbClient(options: DbClientOptions) {
  const connection = postgres(options.url, {
    max: options.maxConnections ?? DEFAULT_WORKER_POOL.max,
    idle_timeout: 30,
    connect_timeout: 10,
  });

  return drizzle(connection, { schema });
}

export type DbClient = ReturnType<typeof createDbClient>;
