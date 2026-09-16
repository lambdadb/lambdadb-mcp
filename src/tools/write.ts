import type {
  CreateCollectionInput,
  DeleteDocsInput,
  UpsertDocsInput
} from "@functional-systems/lambdadb";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { EnvConfig } from "../config/env.js";
import { createLambdaDBClient } from "../lambdadb/client.js";
import { formatLambdaDBError } from "../lambdadb/errors.js";
import { jsonResult, nameSchema, partitionFilterSchema } from "./shared.js";

export function registerWriteTools(server: McpServer, config: EnvConfig): void {
  server.registerTool(
    "lambdadb_create_collection",
    {
      title: "Create Collection",
      description: "Create a new collection in the configured project.",
      annotations: {
        openWorldHint: false
      },
      inputSchema: z.strictObject({
        collectionName: nameSchema,
        indexConfigs: z.record(z.string(), z.any()).refine(
          (value) => Object.keys(value).length > 0,
          "indexConfigs must contain at least one field."
        ),
        description: z.string().max(255).optional(),
        tags: z.record(
          z.string().regex(/^[A-Za-z0-9_.-]{1,63}$/),
          z.string().min(1).max(127).regex(/^[^:#,]+$/)
        )
          .refine((value) => Object.keys(value).length <= 5, "At most five tags are allowed.")
          .optional(),
        snapshotRetentionInDays: z.number().int().min(1).max(31).optional(),
        partitionConfig: z.strictObject({
          fieldName: z.string().min(1),
          dataType: z.literal("keyword"),
          numPartitions: z.number().int().min(2).max(1024)
        }).optional()
      })
    },
    async ({
      collectionName, indexConfigs, description, tags, snapshotRetentionInDays, partitionConfig
    }) => {
      try {
        const client = createLambdaDBClient(config);
        const input: CreateCollectionInput = {
          collectionName,
          indexConfigs,
          description,
          tags,
          snapshotRetentionInDays,
          partitionConfig
        };
        const result = await client.createCollection(input);
        return jsonResult("Collection created successfully.", result);
      } catch (error) {
        throw new Error(formatLambdaDBError(error));
      }
    }
  );

  server.registerTool(
    "lambdadb_upsert_docs",
    {
      title: "Upsert Documents",
      description:
        "Upsert documents into a collection. Keep payloads small enough for the standard API path.",
      annotations: {
        openWorldHint: false
      },
      inputSchema: z.strictObject({
        collectionName: nameSchema,
        docs: z.array(z.record(z.string(), z.any())).min(1),
        branch: nameSchema.optional()
      })
    },
    async ({ collectionName, docs, branch }) => {
      try {
        const client = createLambdaDBClient(config);
        const input: UpsertDocsInput = { docs, branch };
        const result = await client.collection(collectionName).docs.upsert(input);
        return jsonResult("Documents upserted successfully.", result);
      } catch (error) {
        throw new Error(formatLambdaDBError(error));
      }
    }
  );

  server.registerTool(
    "lambdadb_delete_docs",
    {
      title: "Delete Documents",
      description: "Delete documents using exactly one of ids or filter. Omitted branch targets main.",
      annotations: {
        openWorldHint: false
      },
      inputSchema: z.strictObject({
        collectionName: nameSchema,
        ids: z.array(z.string().min(1)).min(1).optional(),
        filter: z.record(z.string(), z.any()).optional(),
        partitionFilter: partitionFilterSchema.optional(),
        branch: nameSchema.optional()
      })
    },
    async ({ collectionName, ids, filter, partitionFilter, branch }) => {
      if ((ids === undefined) === (filter === undefined)) {
        throw new Error("Specify exactly one of ids or filter.");
      }

      try {
        const client = createLambdaDBClient(config);
        const input: DeleteDocsInput = ids !== undefined
          ? { ids, partitionFilter, branch }
          : { filter: filter!, partitionFilter, branch };
        const result = await client.collection(collectionName).docs.delete(input);
        return jsonResult("Documents deleted successfully.", result);
      } catch (error) {
        throw new Error(formatLambdaDBError(error));
      }
    }
  );
}

