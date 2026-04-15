import "dotenv/config";

import { runOrchstrator } from "./orchestrator";
import { logger } from "./utils/logger.util";

async function main() {
  try {
    const githubUrl = process.argv[2];

    if (!githubUrl) {
      throw new Error("Usage: bun run src/index.ts <github-repo-url>");
    }

    await runOrchstrator(githubUrl);
  } catch (error) {
    logger.error({ err: error }, "Repository analysis worker failed");
    process.exit(-1);
  }
}

await main();
