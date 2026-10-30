import { ResourceNotFoundError, SDKValidationError } from "@functional-systems/lambdadb";

type Issue = { code: string; path: (string | number)[]; message: string; [key: string]: unknown };
type IssueTree = { issues: Issue[] };

function valueAt(root: unknown, path: (string | number)[]): unknown {
  return path.reduce<unknown>(
    (value, key) => (value != null && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined),
    root
  );
}

// The SDK prefixes body issues with "requestBody"; tool inputs have no such wrapper.
function label(path: (string | number)[]): string {
  const parts = path[0] === "requestBody" ? path.slice(1) : path;
  return parts.length > 0 ? parts.join(".") : "input";
}

function describeIssue(issue: Issue): string {
  switch (issue.code) {
    case "invalid_type":
    case "invalid_literal":
      return `expected ${JSON.stringify(issue.expected)}, got ${JSON.stringify(issue.received)}`;
    case "invalid_enum_value":
      return `expected one of ${(issue.options as unknown[]).map((option) => JSON.stringify(option)).join(", ")}, got ${JSON.stringify(issue.received)}`;
    case "unrecognized_keys":
      return `unrecognized key(s) ${(issue.keys as string[]).join(", ")}`;
    default:
      return issue.message;
  }
}

function discriminatorIssue(issue: Issue, typeKey: string): boolean {
  return issue.path.join(".") === typeKey && (issue.code === "invalid_literal" || issue.code === "invalid_enum_value");
}

// Report only the union branch selected by the object's `type` discriminator, or the
// accepted `type` values when none matches, instead of every branch's issues.
function unionLines(issue: Issue, root: unknown): string[] {
  const branches = (issue.unionErrors as IssueTree[] | undefined) ?? [];
  const typeKey = [...issue.path, "type"].join(".");
  const value = valueAt(root, issue.path);
  if (value != null && typeof value === "object" && "type" in value) {
    const matching = branches
      .filter((branch) => !branch.issues.some((candidate) => discriminatorIssue(candidate, typeKey)))
      .sort((a, b) => a.issues.length - b.issues.length);
    if (matching.length > 0) return flattenIssues(matching[0].issues, root);
    const accepted = new Set<string>();
    for (const branch of branches) {
      for (const candidate of branch.issues) {
        if (!discriminatorIssue(candidate, typeKey)) continue;
        if (candidate.code === "invalid_literal") accepted.add(JSON.stringify(candidate.expected));
        else for (const option of candidate.options as unknown[]) accepted.add(JSON.stringify(option));
      }
    }
    if (accepted.size > 0) {
      return [`${label([...issue.path, "type"])}: expected one of ${[...accepted].join(", ")}, got ${JSON.stringify((value as { type: unknown }).type)}`];
    }
  }
  const smallest = branches.slice().sort((a, b) => a.issues.length - b.issues.length)[0];
  return smallest ? flattenIssues(smallest.issues, root) : [`${label(issue.path)}: ${issue.message}`];
}

function flattenIssues(issues: Issue[], root: unknown): string[] {
  const lines = new Set<string>();
  for (const issue of issues) {
    const next = issue.code === "invalid_union" ? unionLines(issue, root) : [`${label(issue.path)}: ${describeIssue(issue)}`];
    for (const line of next) lines.add(line);
  }
  return [...lines];
}

function notFoundHint(message: string): string {
  if (/document/i.test(message)) return "";
  if (/branch|tag|alias/i.test(message)) {
    return " Check the name with lambdadb_list_branches, lambdadb_list_tags, or lambdadb_list_aliases.";
  }
  return " Check the collection name with lambdadb_list_collections.";
}

export function formatLambdaDBError(error: unknown): string {
  if (error instanceof SDKValidationError) {
    const cause = error.cause as IssueTree | undefined;
    if (cause && Array.isArray(cause.issues)) {
      return `${error.rawMessage}:\n${flattenIssues(cause.issues, error.rawValue).map((line) => `- ${line}`).join("\n")}`;
    }
  }

  if (error instanceof ResourceNotFoundError) {
    return `${error.message.trim().replace(/\.$/, "")}.${notFoundHint(error.message)}`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error, null, 2);
  } catch {
    return "Unknown LambdaDB error";
  }
}
