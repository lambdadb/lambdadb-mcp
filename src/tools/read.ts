import type {
  FetchDocsInput,
  QueryCollectionInput
} from "@functional-systems/lambdadb";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { EnvConfig } from "../config/env.js";
import { createLambdaDBClient } from "../lambdadb/client.js";
import { formatLambdaDBError } from "../lambdadb/errors.js";
import {
  fieldsSchema,
  jsonResult,
  nameSchema,
  partitionFilterSchema,
  readOptions,
  readRefSchema
} from "./shared.js";

export function registerReadTools(server: McpServer, config: EnvConfig): void {
  server.registerTool(
    "lambdadb_list_collections",
    {
      title: "List Collections",
      description: "List collections in the configured LambdaDB project.",
      annotations: {
        readOnlyHint: true,
        openWorldHint: false
      },
      inputSchema: z.strictObject({
        size: z.number().int().min(1).max(100).optional(),
        pageToken: z.string().optional()
      })
    },
    async ({ size, pageToken }) => {
      try {
        const client = createLambdaDBClient(config);
        const result = await client.listCollections({ size, pageToken });
        return jsonResult("Collections listed successfully.", result);
      } catch (error) {
        throw new Error(formatLambdaDBError(error));
      }
    }
  );

  server.registerTool(
    "lambdadb_get_collection",
    {
      title: "Get Collection",
      description: "Get metadata for a specific collection.",
      annotations: {
        readOnlyHint: true,
        openWorldHint: false
      },
      inputSchema: z.strictObject({
        collectionName: nameSchema
      })
    },
    async ({ collectionName }) => {
      try {
        const client = createLambdaDBClient(config);
        const result = await client.collection(collectionName).get();
        return jsonResult("Collection metadata loaded successfully.", result);
      } catch (error) {
        throw new Error(formatLambdaDBError(error));
      }
    }
  );

  server.registerTool(
    "lambdadb_query_collection",
    {
      title: "Query Collection",
      description:
        "Run a search query against a collection and return the matching documents.",
      annotations: {
        readOnlyHint: true,
        openWorldHint: false
      },
      inputSchema: z.strictObject({
        collectionName: nameSchema,
        size: z.number().int().min(1).max(100).optional(),
        query: z.record(z.string(), z.any()),
        ref: readRefSchema.optional(),
        consistentRead: z.boolean().optional().describe(
          "true requires a direct branch ref or omitted ref (main)."
        ),
        includeVectors: z.boolean().optional(),
        // JSON Schema conversion drops RegExp flags; encode case folding in the pattern.
        sort: z.array(z.record(
          z.string(), z.string().regex(/^([aA][sS][cC]|[dD][eE][sS][cC])$/)
        )).optional(),
        fields: fieldsSchema.optional(),
        partitionFilter: partitionFilterSchema.optional()
      })
    },
    async ({
      collectionName,
      size,
      query,
      ref,
      consistentRead,
      includeVectors,
      sort,
      fields,
      partitionFilter
    }) => {
      try {
        const client = createLambdaDBClient(config);
        const input: QueryCollectionInput = {
          query,
          size,
          ...readOptions(ref, consistentRead),
          includeVectors,
          sort,
          fields,
          partitionFilter
        };
        const result = await client.collection(collectionName).query(input);
        return jsonResult("Collection query completed successfully.", result);
      } catch (error) {
        throw new Error(formatLambdaDBError(error));
      }
    }
  );

  server.registerTool(
    "lambdadb_list_docs",
    {
      title: "List Documents",
      description: "List documents from a collection with pagination support.",
      annotations: {
        readOnlyHint: true,
        openWorldHint: false
      },
      inputSchema: z.strictObject({
        collectionName: nameSchema,
        size: z.number().int().min(1).max(100).optional(),
        pageToken: z.string().optional(),
        ref: readRefSchema.optional(),
        filter: z.record(z.string(), z.any()).optional(),
        fields: fieldsSchema.optional(),
        includeVectors: z.boolean().optional(),
        partitionFilter: partitionFilterSchema.optional()
      })
    },
    async ({
      collectionName, size, pageToken, ref, filter, fields, includeVectors, partitionFilter
    }) => {
      try {
        const client = createLambdaDBClient(config);
        const result = await client.collection(collectionName).docs.list({
          size,
          pageToken,
          ref,
          filter,
          fields,
          includeVectors,
          partitionFilter
        });
        return jsonResult("Documents listed successfully.", result);
      } catch (error) {
        throw new Error(formatLambdaDBError(error));
      }
    }
  );

  server.registerTool(
    "lambdadb_fetch_docs",
    {
      title: "Fetch Documents",
      description: "Fetch specific documents from a collection by document ID.",
      annotations: {
        readOnlyHint: true,
        openWorldHint: false
      },
      inputSchema: z.strictObject({
        collectionName: nameSchema,
        ids: z.array(z.string().min(1)).min(1).max(100),
        ref: readRefSchema.optional(),
        consistentRead: z.boolean().optional().describe(
          "true requires a direct branch ref or omitted ref (main)."
        ),
        includeVectors: z.boolean().optional(),
        fields: fieldsSchema.optional(),
        partitionFilter: partitionFilterSchema.optional()
      })
    },
    async ({
      collectionName,
      ids,
      ref,
      consistentRead,
      includeVectors,
      fields,
      partitionFilter
    }) => {
      try {
        const client = createLambdaDBClient(config);
        const input: FetchDocsInput = {
          ids,
          ...readOptions(ref, consistentRead),
          includeVectors,
          fields,
          partitionFilter
        };
        const result = await client.collection(collectionName).docs.fetch(input);
        return jsonResult("Documents fetched successfully.", result);
      } catch (error) {
        throw new Error(formatLambdaDBError(error));
      }
    }
  );
}
