import type { ReadRef } from "@functional-systems/lambdadb";
import { z } from "zod";

export const nameSchema = z.string().regex(/^[a-zA-Z0-9_-]{3,52}$/);
export const readRefSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("branch"), name: nameSchema }),
  z.strictObject({ kind: z.literal("tag"), name: nameSchema }),
  z.strictObject({ kind: z.literal("alias"), name: nameSchema })
]);

const fieldNames = z.array(z.string().min(1)).min(1);
export const fieldsSchema = z.union([
  z.strictObject({ include: fieldNames, exclude: fieldNames.optional() }),
  z.strictObject({ include: fieldNames.optional(), exclude: fieldNames })
]);
export const partitionFilterSchema = z.strictObject({
  field: z.string().min(1),
  in: z.array(z.string().min(1)).min(1)
});

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

export function jsonResult(title: string, data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: `${title}\n\n${JSON.stringify(data, null, 2)}`
      }
    ]
  };
}

