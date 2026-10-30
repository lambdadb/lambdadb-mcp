import type { LambdaDBClient, ReadRef } from "@functional-systems/lambdadb";
import { z } from "zod";

import type { EnvConfig } from "../config/env.js";
import { createLambdaDBClient } from "../lambdadb/client.js";
import { formatLambdaDBError } from "../lambdadb/errors.js";

export const nameSchema = z.string().regex(/^[a-zA-Z0-9_-]{3,52}$/, "Names use 3–52 letters, digits, underscores, or hyphens.");
export const branchRefSchema = z.strictObject({ kind: z.literal("branch"), name: nameSchema });
export const tagRefSchema = z.strictObject({ kind: z.literal("tag"), name: nameSchema });
export const readRefSchema = z.discriminatedUnion("kind", [
  branchRefSchema,
  tagRefSchema,
  z.strictObject({ kind: z.literal("alias"), name: nameSchema })
]).describe("Read target {kind: 'branch'|'tag'|'alias', name}; omitted reads the main branch. Names come from lambdadb_list_branches, lambdadb_list_tags, or lambdadb_list_aliases.");

const fieldNames = z.array(z.string().min(1)).min(1);
export const fieldsSchema = z.union([
  z.strictObject({ include: fieldNames, exclude: fieldNames.optional() }),
  z.strictObject({ include: fieldNames.optional(), exclude: fieldNames })
]).describe("Projection of returned document fields: {include: [...]} and/or {exclude: [...]} using dot notation for nested paths; include applies before exclude.");
export const partitionFilterSchema = z.strictObject({
  field: z.string().min(1),
  in: z.array(z.string().min(1)).min(1)
}).describe("Only for partitioned collections: {field: <configured partition field>, in: [values]} limits the request to the partitions holding those values.");
export const writeBranchSchema = nameSchema.describe("Writable branch name; omitted writes to main. Tags and aliases are not write targets.");

// Preserve the SDK's discriminated input type after enforcing the ref constraint.
export function readOptions(ref: ReadRef | undefined, consistentRead: boolean | undefined) {
  if (ref && ref.kind !== "branch") {
    if (consistentRead === true) {
      throw new Error("consistentRead=true requires a direct branch ref (or omitted ref for main).");
    }
    return { ref, consistentRead };
  }
  return { ref, consistentRead };
}

// Run one SDK call per tool invocation and surface any failure as a plain tool error.
export async function withLambdaDB<T>(config: EnvConfig, run: (client: LambdaDBClient) => Promise<T>): Promise<T> {
  try {
    return await run(createLambdaDBClient(config));
  } catch (error) {
    throw new Error(formatLambdaDBError(error));
  }
}

// Compact JSON: indentation roughly doubles the tokens a client spends on each result.
export function jsonResult(title: string, data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: `${title}\n\n${JSON.stringify(data)}`
      }
    ]
  };
}

// Keep whole documents up to the configured byte budget and say how many were dropped,
// so a broad query cannot flood the client's context.
export function docsResult(config: EnvConfig, title: string, data: { docs?: unknown[] }) {
  const limit = config.maxResultBytes;
  if (limit === 0 || !Array.isArray(data.docs) || Buffer.byteLength(JSON.stringify(data)) <= limit) {
    return jsonResult(title, data);
  }
  const docs = data.docs;
  const truncated = {
    returnedDocs: 0,
    droppedDocs: 0,
    limitBytes: limit,
    hint: "Result exceeded LAMBDADB_MCP_MAX_RESULT_BYTES. Request fewer documents with size, narrow fields, page with pageToken, or use the SDK for exports."
  };
  let used = Buffer.byteLength(JSON.stringify({ ...data, docs: [], truncated }));
  let keep = 0;
  for (const doc of docs) {
    const size = Buffer.byteLength(JSON.stringify(doc)) + 1;
    if (used + size > limit) break;
    used += size;
    keep++;
  }
  truncated.returnedDocs = keep;
  truncated.droppedDocs = docs.length - keep;
  return jsonResult(`${title} Result truncated to ${keep} of ${docs.length} documents.`, { ...data, docs: docs.slice(0, keep), truncated });
}

