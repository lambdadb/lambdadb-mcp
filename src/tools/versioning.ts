import type { UpdateBranchInput } from "@functional-systems/lambdadb";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { branchRefSchema, jsonResult, nameSchema, tagRefSchema, withLambdaDB } from "./shared.js";
import type { ToolContext } from "./shared.js";
import { updateIndexConfigsSchema } from "./write.js";

const branchSourceSchema = branchRefSchema.extend({
  asOf: z.number().int().min(1_000_000_000_000, "asOf must be Unix epoch milliseconds, not seconds.").optional()
    .describe("Unix epoch milliseconds selecting the latest retained committed snapshot at or before this time, without pending writes. Valid only with a branch source.")
});
// SDK RefSource: a branch (optionally at asOf) or a tag; a tag source has no asOf.
const refSourceSchema = z.discriminatedUnion("kind", [branchSourceSchema, tagRefSchema]);
const aliasTargetSchema = z.discriminatedUnion("kind", [branchRefSchema, tagRefSchema])
  .describe("Existing branch or tag in this collection as {kind: 'branch'|'tag', name}; never another alias.");
const existingName = (kind: "branch" | "tag" | "alias") => nameSchema.describe(
  `Existing ${kind} name from lambdadb_list_${{ branch: "branches", tag: "tags", alias: "aliases" }[kind]}.`
);
const newName = (kind: string) => nameSchema.describe(`New ${kind} name: 3–52 letters, digits, underscores, or hyphens.`);
// ListRefsInput of the SDK; the server returns 10 entries when size is omitted.
const refPageInputs = (plural: string) => ({
  size: z.number().int().min(1).max(100).optional().describe(`${plural} per page (1–100); the server default is 10.`),
  pageToken: z.string().optional().describe("Opaque nextPageToken from the previous response.")
});

export function registerVersioningReadTools(server: McpServer, config: ToolContext): void {
  server.registerTool(
    "lambdadb_list_branches",
    {
      title: "List Branches",
      description: "List one page of branches in a collection in name order, each with its snapshot metadata, numDocs, dataUpdatedAt and own indexConfigs. Follow nextPageToken when more are needed; a page is not the full list. Use the returned names as ref {kind: 'branch'} for reads or as branch for writes; main always exists.",
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: z.strictObject({
        collectionName: nameSchema,
        ...refPageInputs("Branches")
      })
    },
    ({ collectionName, size, pageToken }) => withLambdaDB(config, async client => {
      const result = await client.collection(collectionName).branches.listPage({ size, pageToken });
      return jsonResult("Branches listed successfully.", result);
    })
  );

  server.registerTool(
    "lambdadb_list_tags",
    {
      title: "List Tags",
      description: "List one page of immutable tags in a collection in name order, each with its pinned snapshot, numDocs, dataUpdatedAt and indexConfigs. Follow nextPageToken when more are needed; a page is not the full list. Use the returned names as ref {kind: 'tag'} for stable reads; tags are never write targets.",
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: z.strictObject({
        collectionName: nameSchema,
        ...refPageInputs("Tags")
      })
    },
    ({ collectionName, size, pageToken }) => withLambdaDB(config, async client => {
      const result = await client.collection(collectionName).tags.listPage({ size, pageToken });
      return jsonResult("Tags listed successfully.", result);
    })
  );

  server.registerTool(
    "lambdadb_list_aliases",
    {
      title: "List Aliases",
      description: "List one page of aliases in a collection in name order with their current branch or tag targets and the indexConfigs they serve (null when dangling). Follow nextPageToken when more are needed; a page is not the full list. Use the returned names as ref {kind: 'alias'} for reads, and check every page for references before deleting a branch or tag.",
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: z.strictObject({
        collectionName: nameSchema,
        ...refPageInputs("Aliases")
      })
    },
    ({ collectionName, size, pageToken }) => withLambdaDB(config, async client => {
      const result = await client.collection(collectionName).aliases.listPage({ size, pageToken });
      return jsonResult("Aliases listed successfully.", result);
    })
  );

  server.registerTool(
    "lambdadb_get_branch",
    {
      title: "Get Branch",
      description: "Inspect one branch: its own indexConfigs, numDocs, dataUpdatedAt (null while empty), head and parent snapshots. A branch owns its index schema, so use this instead of lambdadb_get_collection before searching or writing on a branch other than main. A name that is not a branch is not found.",
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: z.strictObject({
        collectionName: nameSchema,
        branchName: existingName("branch")
      })
    },
    ({ collectionName, branchName }) => withLambdaDB(config, async client => {
      const result = await client.collection(collectionName).branches.get(branchName);
      return jsonResult("Branch loaded successfully.", result);
    })
  );

  server.registerTool(
    "lambdadb_get_tag",
    {
      title: "Get Tag",
      description: "Inspect one immutable tag: the snapshot it pins with that snapshot's indexConfigs, numDocs and dataUpdatedAt, none of which change after creation. A name that is not a tag is not found.",
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: z.strictObject({
        collectionName: nameSchema,
        tagName: existingName("tag")
      })
    },
    ({ collectionName, tagName }) => withLambdaDB(config, async client => {
      const result = await client.collection(collectionName).tags.get(tagName);
      return jsonResult("Tag loaded successfully.", result);
    })
  );

  server.registerTool(
    "lambdadb_get_alias",
    {
      title: "Get Alias",
      description: "Inspect one alias: its current branch or tag target and the indexConfigs that reads through it see. A dangling alias (its target is gone) is still returned, with dangling true and indexConfigs null. A name that is not an alias is not found.",
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: z.strictObject({
        collectionName: nameSchema,
        aliasName: existingName("alias")
      })
    },
    ({ collectionName, aliasName }) => withLambdaDB(config, async client => {
      const result = await client.collection(collectionName).aliases.get(aliasName);
      return jsonResult("Alias loaded successfully.", result);
    })
  );
}

export function registerVersioningWriteTools(server: McpServer, config: ToolContext): void {
  server.registerTool(
    "lambdadb_create_branch",
    {
      title: "Create Branch",
      description: "Create a writable branch from a branch or tag in this collection; omitted source uses main. Without asOf the new branch starts from the source's committed snapshot plus the writes already accepted on it; asOf (branch source only) starts from a retained committed snapshot without pending writes. The branch inherits the source's indexConfigs (a tag's pinned schema) and owns them afterwards. Aliases cannot be sources and a tag source rejects asOf. An unavailable asOf fails; no merge or reset is performed. Then write with lambdadb_upsert_docs, lambdadb_update_docs, or lambdadb_delete_docs using branch, read it with ref {kind: 'branch'}, and pin a result with lambdadb_create_tag.",
      annotations: { destructiveHint: false, openWorldHint: false },
      inputSchema: z.strictObject({
        collectionName: nameSchema,
        branchName: newName("branch"),
        source: refSourceSchema.optional()
          .describe("Branch (optionally at asOf) or tag the new branch starts from; omitted uses main. asOf is valid only with a branch source.")
      })
    },
    ({ collectionName, branchName, source }) => withLambdaDB(config, async client => {
      const result = await client.collection(collectionName).branches.create({ branchName, source });
      return jsonResult("Branch created successfully.", result);
    })
  );

  server.registerTool(
    "lambdadb_update_branch",
    {
      title: "Update Branch",
      description: "Update the index schema of one branch; other branches, tags and their aliases keep their own schemas, and updating main also changes the collection's indexConfigs. The change is additive: existing fields cannot be removed and only their description may change; historical documents are not automatically backfilled. Only a branch can be updated: a tag or alias name fails. Read the current schema with lambdadb_get_branch first. Promoting a branch's schema to main means applying the same change to main.",
      annotations: { destructiveHint: true, openWorldHint: false },
      // The SDK rejects empty indexConfigs before any HTTP request.
      inputSchema: z.strictObject({
        collectionName: nameSchema,
        branchName: existingName("branch"),
        indexConfigs: updateIndexConfigsSchema.describe("The branch's complete existing indexConfigs from lambdadb_get_branch (the server-managed id field may be kept or omitted) plus any fields to add, in the same shape as lambdadb_create_collection indexConfigs. Existing fields are sent unchanged except for a new description.")
      })
    },
    ({ collectionName, branchName, indexConfigs }) => withLambdaDB(config, async client => {
      const input = { indexConfigs } as UpdateBranchInput;
      const result = await client.collection(collectionName).branches.update(branchName, input);
      return jsonResult("Branch index schema updated.", result);
    })
  );

  server.registerTool(
    "lambdadb_create_tag",
    {
      title: "Create Tag",
      description: "Pin a branch's or tag's state as an immutable read-only tag with its indexConfigs. Omitted source uses main; source may be a branch (optionally asOf) or tag, never an alias. Without asOf the tag fixes the source snapshot plus the writes already accepted on it; asOf pins a retained committed snapshot only. Empty or unavailable snapshots fail. Route readers to the tag with lambdadb_create_alias or lambdadb_retarget_alias.",
      annotations: { destructiveHint: false, openWorldHint: false },
      inputSchema: z.strictObject({
        collectionName: nameSchema,
        tagName: newName("tag"),
        source: refSourceSchema.optional()
          .describe("Branch (optionally at asOf) or tag whose state is pinned; omitted pins main. asOf is valid only with a branch source.")
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
