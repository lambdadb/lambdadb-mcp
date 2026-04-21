import type {
  FetchDocsInput,
  QueryCollectionInput
} from "@functional-systems/lambdadb";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { EnvConfig } from "../config/env.js";
import { createLambdaDBClient } from "../lambdadb/client.js";
import { formatLambdaDBError } from "../lambdadb/errors.js";
import { jsonResult } from "./shared.js";

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
      inputSchema: {
        size: z.number().int().min(1).max(100).optional(),
        pageToken: z.string().optional()
      }
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
      inputSchema: {
        collectionName: z.string().min(1)
      }
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
      inputSchema: {
        collectionName: z.string().min(1),
        size: z.number().int().min(1).max(100).optional(),
        query: z.record(z.string(), z.any()),
        consistentRead: z.boolean().optional(),
        includeVectors: z.boolean().optional(),
        sort: z.array(z.record(z.string(), z.any())).optional(),
        fields: z.any().optional(),
        partitionFilter: z.any().optional()
      }
    },
    async ({
      collectionName,
      size,
      query,
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
          consistentRead,
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
      inputSchema: {
        collectionName: z.string().min(1),
        size: z.number().int().min(1).max(100).optional(),
        pageToken: z.string().optional()
      }
    },
    async ({ collectionName, size, pageToken }) => {
      try {
        const client = createLambdaDBClient(config);
        const result = await client.collection(collectionName).docs.list({
          size,
          pageToken
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
      inputSchema: {
        collectionName: z.string().min(1),
        ids: z.array(z.string()).min(1).max(100),
        consistentRead: z.boolean().optional(),
        includeVectors: z.boolean().optional(),
        fields: z.any().optional(),
        partitionFilter: z.any().optional()
      }
    },
    async ({
      collectionName,
      ids,
      consistentRead,
      includeVectors,
      fields,
      partitionFilter
    }) => {
      try {
        const client = createLambdaDBClient(config);
        const input: FetchDocsInput = {
          ids,
          consistentRead,
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
