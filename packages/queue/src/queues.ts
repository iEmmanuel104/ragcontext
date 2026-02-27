import { Queue } from "bullmq";
import type { ConnectionOptions } from "bullmq";
import type {
  IngestJobData,
  DeleteJobData,
  SyncJobData,
  ReindexJobData,
} from "@contextinject/types";

export const QUEUE_NAMES = {
  INGEST: "contextinject:ingest",
  DELETE: "contextinject:delete",
  SYNC: "contextinject:sync",
  REINDEX: "contextinject:reindex",
} as const;

export interface QueueConfig {
  connection: ConnectionOptions;
}

export function createQueues(config: QueueConfig) {
  const defaultOpts = {
    connection: config.connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: "exponential" as const,
        delay: 1000,
      },
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 5000 },
    },
  };

  const ingestQueue = new Queue<IngestJobData>(QUEUE_NAMES.INGEST, defaultOpts);

  const deleteQueue = new Queue<DeleteJobData>(QUEUE_NAMES.DELETE, {
    ...defaultOpts,
    defaultJobOptions: {
      ...defaultOpts.defaultJobOptions,
      priority: 1, // High priority for deletes
    },
  });

  const syncQueue = new Queue<SyncJobData>(QUEUE_NAMES.SYNC, defaultOpts);

  const reindexQueue = new Queue<ReindexJobData>(QUEUE_NAMES.REINDEX, {
    ...defaultOpts,
    defaultJobOptions: {
      ...defaultOpts.defaultJobOptions,
      attempts: 2,
    },
  });

  return { ingestQueue, deleteQueue, syncQueue, reindexQueue };
}

export type Queues = ReturnType<typeof createQueues>;
