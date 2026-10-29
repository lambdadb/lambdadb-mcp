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

const facetsSchema = z.record(z.string(), z.strictObject({
  size: z.number().int().min(1).max(100).nullable().optional()
    .describe("Maximum buckets; omitted or null uses the server default of 10.")
})).refine((facets) => Object.keys(facets).length <= 5, "At most five facet fields may be requested.")
  // Zod refinements are not represented in JSON Schema without explicit metadata.
  .meta({ maxProperties: 5 })
  .describe("Keyword field names (including dotted paths) mapped to bucket options. Requires newly built keyword indexes on a supporting server.");

// The SDK validates UTF-8 byte budgets, nonblank text, unique paths/criteria,
// scoring-query requirements and cross-field bounds before sending HTTP.
const rerankSchema = z.strictObject({
  provider: z.literal("typesafe"),
  model: z.literal("jev-1.13.0"),
  queryText: z.string().min(1).describe("Required nonblank query text, at most 8 KiB UTF-8, including for raw vector queries."),
  fields: z.array(z.string().min(1)).min(1).max(8).meta({ uniqueItems: true })
    .describe("Unique stored scalar text paths in model input order; separate from returned fields projection."),
  candidateSize: z.number().int().min(1).max(1000).nullable().optional()
    .describe("Merged candidate cap, at least final size. Omitted/null defaults to max(50, size); never changes knn.k."),
  onFailure: z.enum(["error", "returnOriginal"]).nullable().optional()
    .describe("Omitted/null defaults to error. returnOriginal covers only eligible provider failures."),
  criteria: z.array(z.string().min(1)).min(2).max(10).meta({ uniqueItems: true }).nullable().optional()
    .describe("Distinct nonblank descriptions from lowest to highest relevance, at most 2 KiB each and 8 KiB total UTF-8. Omitted/null uses defaults.")
}).nullable().optional().describe("Optional per-query native reranking; requires a scoring query and positive size, forbids sort. LambdaDB supplies provider credentials.");

export function registerReadTools(server: McpServer, config: EnvConfig): void {
  server.registerTool(
    "lambdadb_list_collections",
    {
      title: "List Collections",
      description: "List one page of collections in the configured project. Follow nextPageToken when more inventory is needed; a page is not the full list. For field types and indexes of a chosen collection, use lambdadb_get_collection.",
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
      description: "Inspect a collection's field types and indexConfigs before constructing searches. Document counts describe committed main, not other refs or pending writes, and are not a query-readiness signal. Use lambdadb_query_collection for documents.",
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
        "Search actual indexed fields; inspect metadata with lambdadb_get_collection first. Omit query for a small match-all sample. Results wrap document fields under docs[].doc; returned documents are not all matches. Empty results alone do not prove an error or indexing delay. Optional Bayesian hybrid search, native reranking and keyword facets require a supporting server; facets require newly built keyword indexes. size: 0 requires facets and forbids reranking. Reranking requires a scoring query and forbids sort; it does not enable vector/hybrid facets. Applied envelope score is an evaluation score, retrievalScore preserves search score, and rerank metadata reports status.",
      annotations: {
        readOnlyHint: true,
        openWorldHint: false
      },
      inputSchema: z.strictObject({
        collectionName: nameSchema,
        size: z.number().int().min(0).max(1000).optional()
          .describe("Documents to return (1–1000), or 0 with nonempty facets."),
        // Preserve SDK/server validation and error classification for free-form queries.
        candidateSize: z.number().int().optional().describe(
          "Bayesian without rerank requires 1 <= size <= candidateSize <= 1000 (size defaults to 10 on the server). With rerank, omit this field and use rerank.candidateSize, whose default is unchanged. Unsupported for other queries; server validates these combinations."
        ),
        query: z.record(z.string(), z.any()).optional().describe(
          "Free-form query; omit for match-all. Top-level bayesian is an array of exactly two subqueries, with no explicit boosts on either subquery or its Boolean descendants. Nested rank fusion and fusion weights are unsupported. Server validates the query contract."
        ),
        facets: facetsSchema.optional(),
        rerank: rerankSchema,
        ref: readRefSchema.optional(),
        consistentRead: z.boolean().optional().describe(
          "Include eligible pending ordinary writes when true; requires a direct branch ref or omitted ref (main), never tag/alias. Does not include pending bulk imports or prove committed indexing; the overlay can return 429. Do not change the default just because a query is empty."
        ),
        includeVectors: z.boolean().optional(),
        // JSON Schema conversion drops RegExp flags; encode case folding in the pattern.
        sort: z.array(z.record(
          z.string(), z.string().regex(/^([aA][sS][cC]|[dD][eE][sS][cC])$/)
        )).optional(),
        fields: fieldsSchema.optional(),
        partitionFilter: partitionFilterSchema.optional()
      }).superRefine((input, context) => {
        if (input.size === 0 && Object.keys(input.facets ?? {}).length === 0) {
          context.addIssue({ code: "custom", path: ["facets"], message: "size: 0 requires at least one facet." });
        }
      }).meta({
        // Claude on Bedrock rejects top-level allOf/anyOf/oneOf. Preserve both
        // cross-field rules with conditionals; reranking already forbids size: 0.
        if: { properties: { rerank: { type: "object" } }, required: ["rerank"] },
        then: {
          required: ["query"],
          properties: { size: { minimum: 1 } },
          not: { required: ["sort"] }
        },
        else: {
          if: { properties: { size: { const: 0 } }, required: ["size"] },
          then: { required: ["facets"], properties: { facets: { minProperties: 1 } } }
        }
      })
    },
    async ({
      collectionName,
      size,
      candidateSize,
      query,
      facets,
      rerank,
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
          facets,
          rerank,
          size,
          candidateSize,
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
      description: "List documents at the selected ref with pagination; follow nextPageToken when needed. This operation has no consistentRead overlay. Use lambdadb_fetch_docs for known IDs or lambdadb_query_collection for indexed search and recent ordinary writes.",
      annotations: {
        readOnlyHint: true,
        openWorldHint: false
      },
      inputSchema: z.strictObject({
        collectionName: nameSchema,
        size: z.number().int().min(1).max(1000).optional(),
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
      description: "Fetch known document IDs at the selected ref. Results wrap document fields under docs[].doc. Missing IDs are not necessarily errors: check the target/ref and, for known recent ordinary writes, consistentRead. Do not reinsert documents as a visibility check.",
      annotations: {
        readOnlyHint: true,
        openWorldHint: false
      },
      inputSchema: z.strictObject({
        collectionName: nameSchema,
        ids: z.array(z.string().min(1)).min(1).max(1000),
        ref: readRefSchema.optional(),
        consistentRead: z.boolean().optional().describe(
          "Include eligible pending ordinary writes when true; requires a direct branch ref or omitted ref (main), never tag/alias. Does not include pending bulk imports or prove committed indexing; the overlay can return 429."
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
