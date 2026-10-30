import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { EnvConfig } from "../config/env.js";
import { branchRefSchema, jsonResult, nameSchema, tagRefSchema, withLambdaDB } from "./shared.js";

const branchSourceSchema = branchRefSchema.extend({
  asOf: z.number().int().min(1_000_000_000_000, "asOf must be Unix epoch milliseconds, not seconds.").optional()
    .describe("Unix epoch milliseconds selecting a retained committed snapshot at or before this time.")
});
const aliasTargetSchema = z.discriminatedUnion("kind", [branchRefSchema, tagRefSchema])
  .describe("Existing branch or tag in this collection as {kind: 'branch'|'tag', name}; never another alias.");
const existingName = (kind: "branch" | "tag" | "alias") => nameSchema.describe(
  `Existing ${kind} name from lambdadb_list_${{ branch: "branches", tag: "tags", alias: "aliases" }[kind]}.`
);
const newName = (kind: string) => nameSchema.describe(`New ${kind} name: 3–52 letters, digits, underscores, or hyphens.`);

export function registerVersioningReadTools(server: McpServer, config: EnvConfig): void {
  server.registerTool(
    "lambdadb_list_branches",
    {
      title: "List Branches",
      description: "List branches in a collection, including their version metadata. Use the returned names as ref {kind: 'branch'} for reads or as branch for writes; main always exists.",
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: z.strictObject({
        collectionName: nameSchema
      })
    },
    ({ collectionName }) => withLambdaDB(config, async client => {
      const result = await client.collection(collectionName).branches.list();
      return jsonResult("Branches listed successfully.", result);
    })
  );

  server.registerTool(
    "lambdadb_list_tags",
    {
      title: "List Tags",
      description: "List immutable tags in a collection, including their version metadata. Use the returned names as ref {kind: 'tag'} for stable reads; tags are never write targets.",
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: z.strictObject({
        collectionName: nameSchema
      })
    },
    ({ collectionName }) => withLambdaDB(config, async client => {
      const result = await client.collection(collectionName).tags.list();
      return jsonResult("Tags listed successfully.", result);
    })
  );

  server.registerTool(
    "lambdadb_list_aliases",
    {
      title: "List Aliases",
      description: "List aliases in a collection with their current branch or tag targets. Use the returned names as ref {kind: 'alias'} for reads, and check here for references before deleting a branch or tag.",
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: z.strictObject({
        collectionName: nameSchema
      })
    },
    ({ collectionName }) => withLambdaDB(config, async client => {
      const result = await client.collection(collectionName).aliases.list();
      return jsonResult("Aliases listed successfully.", result);
    })
  );
}

export function registerVersioningWriteTools(server: McpServer, config: EnvConfig): void {
  server.registerTool(
    "lambdadb_create_branch",
    {
      title: "Create Branch",
      description: "Create a writable branch from another branch in this collection; omitted source uses main. Only committed state is copied, never pending writes. Tags and aliases cannot be sources. An unavailable asOf fails; no merge or reset is performed. Then write with lambdadb_upsert_docs, lambdadb_update_docs, or lambdadb_delete_docs using branch, read it with ref {kind: 'branch'}, and pin a result with lambdadb_create_tag.",
      annotations: { destructiveHint: false, openWorldHint: false },
      inputSchema: z.strictObject({
        collectionName: nameSchema,
        branchName: newName("branch"),
        source: branchSourceSchema.optional().describe("Branch whose committed state is copied, optionally at asOf; omitted copies main.")
      })
    },
    ({ collectionName, branchName, source }) => withLambdaDB(config, async client => {
      const result = await client.collection(collectionName).branches.create({ branchName, source });
      return jsonResult("Branch created successfully.", result);
    })
  );

  server.registerTool(
    "lambdadb_create_tag",
    {
      title: "Create Tag",
      description: "Pin committed state as an immutable read-only tag. Omitted source uses main; source may be a branch (optionally asOf) or tag, never an alias. Acceptance of a write does not guarantee its inclusion. Empty or unavailable snapshots fail. Route readers to the tag with lambdadb_create_alias or lambdadb_retarget_alias.",
      annotations: { destructiveHint: false, openWorldHint: false },
      inputSchema: z.strictObject({
        collectionName: nameSchema,
        tagName: newName("tag"),
        source: z.discriminatedUnion("kind", [branchSourceSchema, tagRefSchema]).optional()
          .describe("Branch (optionally at asOf) or tag whose committed snapshot is pinned; omitted pins main.")
      })
    },
    ({ collectionName, tagName, source }) => withLambdaDB(config, async client => {
      const result = await client.collection(collectionName).tags.create({ tagName, source });
      return jsonResult("Tag created successfully.", result);
    })
  );

  server.registerTool(
    "lambdadb_create_alias",
    {
      title: "Create Alias",
      description: "Create a read alias targeting an existing branch or tag in this collection. Readers then pass ref {kind: 'alias', name} to lambdadb_query_collection, lambdadb_fetch_docs, or lambdadb_list_docs. An alias is not a write target and cannot target another alias.",
      annotations: { destructiveHint: false, openWorldHint: false },
      inputSchema: z.strictObject({
        collectionName: nameSchema,
        aliasName: newName("alias"),
        target: aliasTargetSchema
      })
    },
    ({ collectionName, aliasName, target }) => withLambdaDB(config, async client => {
      const result = await client.collection(collectionName).aliases.create({ aliasName, target });
      return jsonResult("Alias created successfully.", result);
    })
  );

  server.registerTool(
    "lambdadb_retarget_alias",
    {
      title: "Retarget Alias",
      description: "Switch an existing alias to a branch or tag. Every reader using the alias sees the new target immediately, so confirm with the user first. Does not merge data, change write targets, or restore agent execution state.",
      annotations: { destructiveHint: true, openWorldHint: false },
      inputSchema: z.strictObject({
        collectionName: nameSchema,
        aliasName: existingName("alias"),
        target: aliasTargetSchema
      })
    },
    ({ collectionName, aliasName, target }) => withLambdaDB(config, async client => {
      const result = await client.collection(collectionName).aliases.retarget(aliasName, { target });
      return jsonResult("Alias retargeted successfully.", result);
    })
  );

  server.registerTool(
    "lambdadb_delete_branch",
    {
      title: "Delete Branch",
      description: "Delete a branch and its uncommitted and committed data; confirm with the user first. The default main branch cannot be deleted. Deletion fails while any alias references the branch: check lambdadb_list_aliases and use lambdadb_retarget_alias or lambdadb_delete_alias first.",
      annotations: { destructiveHint: true, openWorldHint: false },
      inputSchema: z.strictObject({
        collectionName: nameSchema,
        branchName: existingName("branch")
      })
    },
    ({ collectionName, branchName }) => withLambdaDB(config, async client => {
      const result = await client.collection(collectionName).branches.delete(branchName);
      return jsonResult("Branch deleted successfully.", result);
    })
  );

  server.registerTool(
    "lambdadb_delete_tag",
    {
      title: "Delete Tag",
      description: "Delete an immutable tag, removing its snapshot retention pin; confirm with the user first. Deletion fails while any alias references the tag: check lambdadb_list_aliases and use lambdadb_retarget_alias or lambdadb_delete_alias first.",
      annotations: { destructiveHint: true, openWorldHint: false },
      inputSchema: z.strictObject({
        collectionName: nameSchema,
        tagName: existingName("tag")
      })
    },
    ({ collectionName, tagName }) => withLambdaDB(config, async client => {
      const result = await client.collection(collectionName).tags.delete(tagName);
      return jsonResult("Tag deleted successfully.", result);
    })
  );

  server.registerTool(
    "lambdadb_delete_alias",
    {
      title: "Delete Alias",
      description: "Delete an alias so reads through it fail; its target branch or tag is not deleted. Confirm with the user first.",
      annotations: { destructiveHint: true, openWorldHint: false },
      inputSchema: z.strictObject({
        collectionName: nameSchema,
        aliasName: existingName("alias")
      })
    },
    ({ collectionName, aliasName }) => withLambdaDB(config, async client => {
      const result = await client.collection(collectionName).aliases.delete(aliasName);
      return jsonResult("Alias deleted successfully.", result);
    })
  );
}
