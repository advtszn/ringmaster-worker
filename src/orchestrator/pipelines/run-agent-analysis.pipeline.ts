import { Sandbox } from "@e2b/code-interpreter";

import { AgentRepoAnalysisPromptTemplate } from "../../prompts/agent-repo-analysis.prompt";
import { logger } from "../../utils/logger.util";

const OPENCODE_CONFIG = JSON.stringify(
  {
    $schema: "https://opencode.ai/config.json",
    enabled_providers: ["google"],
    provider: {
      google: {
        options: {
          apiKey: "{env:GOOGLE_GENERATIVE_AI_API_KEY}",
        },
      },
    },
    model: "google/gemini-2.5-pro",
  },
  null,
  2,
);

export type RunAgentAnalysisPipelineOptions = {
  githubUrl: string;
  googleApiKey: string;
  onStdout?: (data: string) => void;
  onStderr?: (data: string) => void;
};

export async function runAgentAnalysisPipeline({
  githubUrl,
  googleApiKey,
  onStdout,
  onStderr,
}: RunAgentAnalysisPipelineOptions) {
  const repoAnalysisPromptTemplate = new AgentRepoAnalysisPromptTemplate();
  const repoPath = "/home/user/repo";
  const agentConfigPath = `${repoPath}/.opencode/agents/repo-analysis.md`;
  const opencodeConfigPath = `${repoPath}/opencode.json`;

  logger.info("Creating E2B sandbox");
  const sandbox = await Sandbox.create("opencode", {
    envs: {
      GOOGLE_GENERATIVE_AI_API_KEY: googleApiKey,
    },
    timeoutMs: 600_000,
  });

  logger.info({ repoPath }, "Cloning repository into sandbox");
  await sandbox.git.clone(githubUrl, {
    path: repoPath,
    depth: 1,
  });

  logger.info({ agentConfigPath }, "Writing repo analysis agent config");
  await sandbox.files.write(
    agentConfigPath,
    repoAnalysisPromptTemplate.agentConfigMarkdown,
  );

  logger.info({ opencodeConfigPath }, "Writing OpenCode config");
  await sandbox.files.write(opencodeConfigPath, OPENCODE_CONFIG);

  logger.info("Running OpenCode repo analysis agent");
  return sandbox.commands.run(
    `opencode run --agent repo-analysis --format json "Analyze this repository for AI agent implementation patterns using static analysis only."`,
    {
      cwd: repoPath,
      onStdout: (data) => {
        onStdout?.(String(data));
      },
      onStderr: (data) => {
        onStderr?.(String(data));
      },
      timeoutMs: 600_000,
    },
  );
}
