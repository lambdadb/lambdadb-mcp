import { LambdaDBClient } from "@functional-systems/lambdadb";

import type { ProjectEnv } from "../config/env.js";

export function createLambdaDBClient(config: ProjectEnv): LambdaDBClient {
  return new LambdaDBClient({
    baseUrl: config.baseUrl,
    projectName: config.projectName,
    projectApiKey: config.projectApiKey
  });
}
