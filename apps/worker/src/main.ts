import { Worker } from "bullmq";
import type { ConnectionOptions } from "bullmq";
import { QUEUE_NAMES } from "@contextinject/queue";
import type {
  IngestJobData,
  DeleteJobData,
  SyncJobData,
  ReindexJobData,
} from "@contextinject/types";
import { processIngest } from "./processors/ingest.js";
import { processDelete } from "./processors/delete.js";
import { processSync } from "./processors/sync.js";
import { processReindex } from "./processors/reindex.js";

const REDIS_URL = process.env["REDIS_URL"] ?? "redis://localhost:6379";

function parseRedisConnection(url: string): ConnectionOptions {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port) || 6379,
    password: parsed.password || undefined,
  };
}

function createWorkers(connection: ConnectionOptions): Worker[] {
  const ingestWorker = new Worker<IngestJobData>(
    QUEUE_NAMES.INGEST,
    async (job) => {
      await processIngest(job.data);
    },
    { connection, concurrency: 5 },
  );

  const deleteWorker = new Worker<DeleteJobData>(
    QUEUE_NAMES.DELETE,
    async (job) => {
      await processDelete(job.data);
    },
    { connection, concurrency: 3 },
  );

  const syncWorker = new Worker<SyncJobData>(
    QUEUE_NAMES.SYNC,
    async (job) => {
      await processSync(job.data);
    },
    { connection, concurrency: 2 },
  );

  const reindexWorker = new Worker<ReindexJobData>(
    QUEUE_NAMES.REINDEX,
    async (job) => {
      await processReindex(job.data);
    },
    { connection, concurrency: 1 },
  );

  return [ingestWorker, deleteWorker, syncWorker, reindexWorker];
}

async function main(): Promise<void> {
  const connection = parseRedisConnection(REDIS_URL);
  const workers = createWorkers(connection);

  console.warn(`[worker] Started ${String(workers.length)} workers`);
  console.warn(`[worker] Listening on queues: ${Object.values(QUEUE_NAMES).join(", ")}`);

  const shutdown = async (): Promise<void> => {
    console.warn("[worker] Shutting down...");
    await Promise.all(workers.map((w) => w.close()));
    console.warn("[worker] All workers closed");
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
}

main().catch((err) => {
  console.error("[worker] Fatal error:", err);
  process.exit(1);
});
