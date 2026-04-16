import { Sandbox } from "@e2b/code-interpreter";

import { RepoAnalysisSkillPromptTemplate } from "../../prompts/repo-analysis-skill.prompt";
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
    model: "google/gemini-3.1-pro-preview",
    agent: {
      plan: {
        permission: {
          edit: "deny",
          bash: {
            "*": "allow",
          },
          webfetch: "deny",
          skill: {
            "*": "deny",
            "repo-analysis": "allow",
          },
        },
      },
    },
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
  const repoAnalysisPromptTemplate = new RepoAnalysisSkillPromptTemplate();
  const repoPath = "/home/user/repo";
  const skillConfigPath = `${repoPath}/.opencode/skills/repo-analysis/SKILL.md`;
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

  logger.info({ skillConfigPath }, "Writing repo analysis skill config");
  await sandbox.files.write(
    skillConfigPath,
    repoAnalysisPromptTemplate.skillMarkdown,
  );

  logger.info({ opencodeConfigPath }, "Writing OpenCode config");
  await sandbox.files.write(opencodeConfigPath, OPENCODE_CONFIG);

  logger.info("Running OpenCode repo analysis skill with plan agent");
  return sandbox.commands.run(
    `opencode run --agent plan --format json "Load the \`repo-analysis\` skill and analyze this repository for AI agent implementation patterns using static analysis only. Follow the skill's output format exactly."`,
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
