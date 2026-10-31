import type {
  CreateCollectionInput,
  DeleteDocsInput,
  UpdateCollectionInput,
  UpsertDocsInput
} from "@functional-systems/lambdadb";
import { Analyzer } from "@functional-systems/lambdadb/models";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { EnvConfig } from "../config/env.js";
import { jsonResult, nameSchema, partitionFilterSchema, withLambdaDB, writeBranchSchema } from "./shared.js";

const tagsSchema = z.record(
  z.string().regex(/^[A-Za-z0-9_.-]{1,63}$/, "Tag keys use 1–63 letters, digits, dots, underscores, or hyphens."),
  z.string().min(1).max(127).regex(/^[^:#,]+$/, "Tag values are 1–127 characters without ':', '#', or ','.")
).refine((value) => Object.keys(value).length <= 5, "At most five tags are allowed.");
const retentionSchema = z.number().int().min(1).max(31);
const docsSchema = z.array(z.record(z.string(), z.any())).min(1);
// Partial updates must name the stored document; validate that before any HTTP request.
const patchesSchema = z.array(z.looseObject({ id: z.string().min(1) })).min(1);

export function registerWriteTools(server: McpServer, config: EnvConfig): void {
  server.registerTool(
    "lambdadb_create_collection",
    {
      title: "Create Collection",
      description: "Create a new collection in the configured project. Define every field to search, filter, sort, or facet on in indexConfigs (text, keyword, vector, sparseVector, boolean, datetime, long, double, object); the server-managed id field may be omitted. Keyword indexes built on a supporting server support facets. Native embedding vector fields (providers openai, cohere) accept embedding without managedEmbedding; explicit managedEmbedding: true remains supported for older servers. Then load documents with lambdadb_upsert_docs or lambdadb_bulk_upsert_docs.",
      annotations: {
        destructiveHint: false,
        openWorldHint: false
      },
      inputSchema: z.strictObject({
        collectionName: nameSchema,
        indexConfigs: z.record(z.string(), z.any()).refine(
          (value) => Object.keys(value).length > 0,
          "indexConfigs must contain at least one field."
        ).describe(`Field configurations validated by the SDK/server. Native embedding vectors: {type: 'vector', embedding: {provider: 'openai'|'cohere', model, sourceField or sources, dimensions?, similarity?}}. Use exactly one non-null sourceField (legacy single text path) or sources (1-16 ordered {field, type: 'text'|'image'} mappings; OpenAI requires exactly one text source, Cohere accepts text and image sources). Source paths may be unindexed stored paths. Native embedding dimensions/similarity belong inside embedding, never at the field top level. Do not combine embedding with managedEmbedding: false. Legacy true is preserved; no provider/model or native embedding defaults are inferred. Caller-provided vectors retain top-level dimensions/similarity. Supplied dimensions must be integers from 64 to 4096; similarity supports only cosine or euclidean. Model-specific native dimensions and provider/model/source combinations are server-validated. The server-managed id field may be omitted or sent unchanged as {type: 'keyword'}. Text fields accept analyzers from these fixed lowercase presets (omitted uses standard; custom pipelines/options are unsupported; the keyword analyzer is distinct from the keyword field type): ${Object.values(Analyzer).join(", ")}.`),
        description: z.string().max(255).optional().describe("Human-readable collection description (max 255 chars)."),
        tags: tagsSchema.optional().describe("Up to five metadata key/value tags (keys [A-Za-z0-9_.-]{1,63}, values 1–127 chars without : # ,). These are not version Tags."),
        snapshotRetentionInDays: retentionSchema.optional().describe("Days of committed snapshot history to retain (1–31) for asOf branch sources and tag creation."),
        partitionConfig: z.strictObject({
          fieldName: z.string().min(1),
          dataType: z.literal("keyword"),
          numPartitions: z.number().int().min(2).max(1024)
        }).optional().describe("Optional physical partitioning by a keyword field: {fieldName, dataType: 'keyword', numPartitions: 2–1024}. Reads and deletes may then pass partitionFilter.")
      })
    },
    ({
      collectionName, indexConfigs, description, tags, snapshotRetentionInDays, partitionConfig
    }) => withLambdaDB(config, async client => {
      const input: CreateCollectionInput = {
        collectionName,
        indexConfigs,
        description,
        tags,
        snapshotRetentionInDays,
        partitionConfig
      };
      const result = await client.createCollection(input);
      return jsonResult("Collection created; query-serving readiness has not been verified.", result);
    })
  );

  server.registerTool(
    "lambdadb_upsert_docs",
    {
      title: "Upsert Documents",
      description:
        "Insert or fully replace documents on a writable branch (omitted branch is main); a document with an existing id overwrites that document. Keep payloads small enough for the standard API path; use lambdadb_bulk_upsert_docs for large batches. Acceptance does not prove committed indexing: verify with lambdadb_fetch_docs using consistentRead on the same branch, and do not replay writes to wait for visibility. Inspect an uncertain outcome before any explicit retry. For native embedding fields, provide the configured sources at their stored JSON paths, or supply the vector directly to skip inference.",
      annotations: {
        destructiveHint: true,
        openWorldHint: false
      },
      inputSchema: z.strictObject({
        collectionName: nameSchema,
        docs: docsSchema.describe("Full documents. Each may carry a string id that replaces the whole stored document with that id; an omitted id is generated and not returned, so assign ids when you need to fetch, update, or delete later."),
        branch: writeBranchSchema.optional()
      })
    },
    ({ collectionName, docs, branch }) => withLambdaDB(config, async client => {
      const input: UpsertDocsInput = { docs, branch };
      const result = await client.collection(collectionName).docs.upsert(input);
      return jsonResult("Document upserts accepted; committed search visibility has not been verified.", result);
    })
  );

  server.registerTool(
    "lambdadb_delete_docs",
    {
      title: "Delete Documents",
      description: "Delete documents by ids or by filter on a writable branch (omitted branch is main); specify exactly one selector. Confirm with the user before deleting, and preview a filter with lambdadb_list_docs first. To clear every document while keeping the collection, use filter {queryString: {query: '*:*'}}; lambdadb_delete_collection also removes indexes, branches, tags, and aliases.",
      annotations: {
        destructiveHint: true,
        openWorldHint: false
      },
      inputSchema: z.strictObject({
        collectionName: nameSchema,
        ids: z.array(z.string().min(1)).min(1).optional().describe("Document ids to delete."),
        filter: z.record(z.string(), z.any()).optional().describe("Delete every document matching this filter, e.g. {queryString: {query: 'genre:documentary AND year:2019'}}; same queryString/bool shapes as lambdadb_query_collection."),
        partitionFilter: partitionFilterSchema.optional(),
        branch: writeBranchSchema.optional()
      })
    },
    async ({ collectionName, ids, filter, partitionFilter, branch }) => {
      if ((ids === undefined) === (filter === undefined)) {
        throw new Error("Specify exactly one of ids or filter.");
      }

      return withLambdaDB(config, async client => {
        const input: DeleteDocsInput = ids !== undefined
          ? { ids, partitionFilter, branch }
          : { filter: filter!, partitionFilter, branch };
        const result = await client.collection(collectionName).docs.delete(input);
        return jsonResult("Documents deleted successfully.", result);
      });
    }
  );

  server.registerTool(
    "lambdadb_update_collection",
    {
      title: "Update Collection",
      description: "Update collection description, metadata tags, snapshot retention, or additive index configuration. Existing indexed fields cannot be redefined or removed; historical documents are not automatically backfilled. Lowering retention can shorten available history. Omitted or null values leave settings unchanged; use an empty description or empty tags object to clear those fields. Retention cannot be cleared. These metadata tags are not version Tags.",
      annotations: { destructiveHint: true, openWorldHint: false },
      // The SDK rejects empty indexConfigs and inputs without a non-null field
      // before any HTTP request. The server treats null as unchanged.
      inputSchema: z.strictObject({
        collectionName: nameSchema,
        indexConfigs: z.record(z.string(), z.any()).optional().describe("New fields to add, in the same shape as lambdadb_create_collection indexConfigs; existing fields cannot be changed or removed."),
        description: z.string().max(255).nullable().optional().describe("New description (max 255 chars); an empty string clears it. Null leaves it unchanged."),
        tags: tagsSchema.nullable().optional().describe("Replacement metadata tags (up to five); an empty object clears them. Null leaves them unchanged. These are not version Tags."),
        snapshotRetentionInDays: retentionSchema.nullable().optional().describe("Retention in days (1–31). Null leaves it unchanged; it cannot be cleared. Lowering it can shorten available asOf history.")
      })
    },
    ({ collectionName, ...changes }) => withLambdaDB(config, async client => {
      const result = await client.collection(collectionName).update(changes as UpdateCollectionInput);
      return jsonResult("Collection settings updated; index readiness has not been verified.", result);
    })
  );

  server.registerTool(
    "lambdadb_delete_collection",
    {
      title: "Delete Collection",
      description: "Permanently delete the entire collection with all documents, branches, tags, and aliases. Irreversible: confirm with the user first. Use lambdadb_delete_docs to remove only some documents.",
      annotations: { destructiveHint: true, openWorldHint: false },
      inputSchema: z.strictObject({
        collectionName: nameSchema
      })
    },
    ({ collectionName }) => withLambdaDB(config, async client => {
      const result = await client.collection(collectionName).delete();
      return jsonResult("Collection deleted successfully.", result);
    })
  );

  server.registerTool(
    "lambdadb_update_docs",
    {
      title: "Update Documents",
      description: "Partially update existing documents by ID on a writable branch (omitted branch is main). Omitted fields are preserved, nested objects merge, and arrays are replaced. A missing ID fails rather than inserting a new document; use lambdadb_upsert_docs to insert or replace whole documents. Acceptance does not prove committed indexing: verify with lambdadb_fetch_docs using consistentRead on the same branch.",
      annotations: { destructiveHint: true, openWorldHint: false },
      inputSchema: z.strictObject({
        collectionName: nameSchema,
        docs: patchesSchema.describe("Partial documents, each with the existing string id plus only the fields to change, e.g. [{id: 'doc-1', title: 'New title'}]. Indexed fields reject null."),
        branch: writeBranchSchema.optional()
      })
    },
    ({ collectionName, docs, branch }) => withLambdaDB(config, async client => {
      const result = await client.collection(collectionName).docs.update({ docs, branch });
      return jsonResult("Document mutations accepted; committed search visibility has not been verified.", result);
    })
  );

  server.registerTool(
    "lambdadb_bulk_upsert_docs",
    {
      title: "Bulk Upsert Documents",
      description: "Upload a document array and submit it for bulk ingestion using the SDK workflow; documents with existing ids are replaced. Inputs must fit the MCP stdio message limit (10 MiB including JSON-RPC overhead); use the SDK directly for larger files. Native embedding fields require supplied vectors; bulk never generates embeddings. Pending bulk imports are excluded from consistentRead, so confirm later with lambdadb_fetch_docs without it. Inspect uncertain outcomes before retrying; do not replay writes to wait for indexing.",
      annotations: { destructiveHint: true, openWorldHint: false },
      inputSchema: z.strictObject({
        collectionName: nameSchema,
        docs: docsSchema.describe("Full documents as for lambdadb_upsert_docs, with vector fields supplied directly."),
        branch: writeBranchSchema.optional()
      })
    },
    ({ collectionName, docs, branch }) => withLambdaDB(config, async client => {
      const result = await client.collection(collectionName).docs.bulkUpsertDocs({ docs, branch });
      return jsonResult("Document mutations accepted; committed search visibility has not been verified.", result);
    })
  );
}
