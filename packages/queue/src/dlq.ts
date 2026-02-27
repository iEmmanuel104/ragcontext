import { Queue } from "bullmq";
import type { ConnectionOptions } from "bullmq";
import type { AnyJobData } from "@contextinject/types";

export const DLQ_NAME = "contextinject:dead-letter";

export function createDeadLetterQueue(connection: ConnectionOptions) {
  return new Queue<AnyJobData & { originalQueue: string; failureReason: string }>(DLQ_NAME, {
    connection,
    defaultJobOptions: {
      removeOnComplete: false,
      removeOnFail: false,
    },
  });
}

export type DeadLetterQueue = ReturnType<typeof createDeadLetterQueue>;
