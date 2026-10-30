import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

// Provider timeouts, rate limits and outages are transient under shared load; with
// onFailure "returnOriginal" they arrive as a fallback naming the reason. Retry only
// those, a bounded number of times. Credential, invalid-response and any other
// fallback fails at once, and a fallback never counts as applied reranking.
const transientRerankReasons = new Set(["timeout", "rateLimit", "unavailable"]);
const rerankAttempts = 3;

/** Run a reranked lambdadb_query_collection call through `call`, retrying transient fallbacks. */
export async function rerankQuery(call, args, label) {
  // A request that sets onFailure itself is contract coverage: send it unchanged, once.
  if ("onFailure" in args.rerank) return call("query_collection", args);
  const { model } = args.rerank;
  for (let attempt = 1; ; attempt++) {
    const result = await call("query_collection", { ...args, rerank: { ...args.rerank, onFailure: "returnOriginal" } });
    if (result.rerank?.status !== "fallback") return result;
    const { reason } = result.rerank;
    // Documented fallback shape: retrieval order without rerank scores or criteria.
    assert.equal(result.rerank.scoredCount, 0, `${label} ${model} fallback must not report scores`);
    assert.equal(result.rerank.criteriaVersion, undefined, `${label} ${model} fallback must omit criteriaVersion`);
    assert.ok(result.docs.length <= args.size, `${label} ${model} fallback must return at most size docs`);
    assert.ok(result.docs.every(hit => hit.retrievalScore === undefined), `${label} ${model} fallback must omit retrievalScore`);
    if (!transientRerankReasons.has(reason) || attempt >= rerankAttempts) {
      // Logged as well because some suites replace assertion messages with their stage.
      const message = `${label} ${model} fell back with reason ${reason} on attempt ${attempt}/${rerankAttempts}`;
      console.error(`[live] ${message}`);
      assert.fail(message);
    }
    console.info(`[live] ${label} ${model} fell back with reason ${reason}; retrying (${attempt + 1}/${rerankAttempts})`);
    await delay(attempt * 5_000);
  }
}
