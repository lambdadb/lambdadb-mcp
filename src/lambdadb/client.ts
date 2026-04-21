import { LambdaDBClient } from "@functional-systems/lambdadb";

import type { EnvConfig } from "../config/env.js";

export function createLambdaDBClient(config: EnvConfig): LambdaDBClient {
  return new LambdaDBClient({
    baseUrl: config.baseUrl,
    projectName: config.projectName,
    projectApiKey: config.projectApiKey
  });
}
