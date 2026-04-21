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
import { jsonResult } from "./shared.js";

export function registerWriteTools(server: McpServer, config: EnvConfig): void {
  server.registerTool(
    "lambdadb_create_collection",
    {
      title: "Create Collection",
      description: "Create a new collection in the configured project.",
      annotations: {
        openWorldHint: false
      },
      inputSchema: {
        collectionName: z.string().min(1).max(52),
        indexConfigs: z.record(z.string(), z.any()).optional(),
        partitionConfig: z.any().optional()
      }
    },
    async ({ collectionName, indexConfigs, partitionConfig }) => {
      try {
        const client = createLambdaDBClient(config);
        const input: CreateCollectionInput = {
          collectionName,
          indexConfigs,
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
      inputSchema: {
        collectionName: z.string().min(1),
        docs: z.array(z.record(z.string(), z.any())).min(1)
      }
    },
    async ({ collectionName, docs }) => {
      try {
        const client = createLambdaDBClient(config);
        const input: UpsertDocsInput = { docs };
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
      description: "Delete documents by IDs or by a filter from a collection.",
      annotations: {
        openWorldHint: false
      },
      inputSchema: {
        collectionName: z.string().min(1),
        ids: z.array(z.string()).optional(),
        filter: z.record(z.string(), z.any()).optional(),
        partitionFilter: z.any().optional()
      }
    },
    async ({ collectionName, ids, filter, partitionFilter }) => {
      if (!ids && !filter) {
        throw new Error("Either ids or filter is required.");
      }

      try {
        const client = createLambdaDBClient(config);
        const input: DeleteDocsInput = {
          ids,
          filter,
          partitionFilter
        };
        const result = await client.collection(collectionName).docs.delete(input);
        return jsonResult("Documents deleted successfully.", result);
      } catch (error) {
        throw new Error(formatLambdaDBError(error));
      }
    }
  );
}

