import { once } from "node:events";
import { createWriteStream } from "node:fs";
import z from "zod";

import { parseAgentAnalysis } from "./parse-agent-analysis";
import { logger } from "../utils/logger.util";
import { runAgentAnalysisPipeline } from "./pipelines/run-agent-analysis.pipeline";

type JsonLineCapture = {
  buffer: string;
  linesWritten: number;
};

type OpencodeEvent = {
  type: string;
  sessionID?: string;
  part?: {
    text?: string;
    tool?: string;
    reason?: string;
    cost?: number;
    tokens?: {
      total: number;
      input: number;
      output: number;
      reasoning?: number;
    };
  };
};

type RunSummary = {
  sessionId?: string;
  textParts: string[];
  toolCalls: Set<string>;
  lastStepFinish?: {
    reason?: string;
    cost?: number;
    tokens?: {
      total: number;
      input: number;
      output: number;
      reasoning?: number;
    };
  };
};

export type RunOrchestratorResult = {
  rawAnalysis: string;
  structuredAnalysis: Awaited<ReturnType<typeof parseAgentAnalysis>>;
  jsonlLogPath: string;
  sessionId?: string;
  toolCalls: string[];
  finalStep?: RunSummary["lastStepFinish"];
};

function captureJsonLines(
  capture: JsonLineCapture,
  data: string,
  writeLine: (line: string) => void,
) {
  capture.buffer += data;

  const lines = capture.buffer.split("\n");
  capture.buffer = lines.pop() ?? "";

  for (const line of lines) {
    const trimmedLine = line.trim();

    if (!trimmedLine) {
      continue;
    }

    try {
      JSON.parse(trimmedLine);
      writeLine(trimmedLine);
      capture.linesWritten += 1;
    } catch {
      // OpenCode can emit non-JSON setup output before the event stream begins.
    }
  }
}

function finalizeJsonLines(
  capture: JsonLineCapture,
  writeLine: (line: string) => void,
) {
  const trailingLine = capture.buffer.trim();

  if (!trailingLine) {
    return;
  }

  try {
    JSON.parse(trailingLine);
    writeLine(trailingLine);
    capture.linesWritten += 1;
  } catch {
    // Ignore trailing non-JSON output.
  }
}

function consumeOpencodeEvent(summary: RunSummary, line: string) {
  const event = JSON.parse(line) as OpencodeEvent;

  summary.sessionId ??= event.sessionID;

  if (event.type === "text" && event.part?.text) {
    summary.textParts.push(event.part.text);
  }

  if (event.type === "tool_use" && event.part?.tool) {
    summary.toolCalls.add(event.part.tool);
  }

  if (event.type === "step_finish") {
    summary.lastStepFinish = {
      reason: event.part?.reason,
      cost: event.part?.cost,
      tokens: event.part?.tokens,
    };
  }
}

export async function runOrchstrator(githubUrl: string) {
  logger.info({ githubUrl }, "Starting repository analysis worker");

  const googleApiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;

  if (!googleApiKey) {
    logger.error("Missing Google API key");
    throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is not set");
  }

  const githubUrlValidation = z
    .string()
    .regex(
      /^https?:\/\/(www\.)?github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/,
    )
    .safeParse(githubUrl);

  if (!githubUrlValidation.success) {
    logger.error({ githubUrl }, "Invalid GitHub repository URL");
    throw new Error("Failed to parse github repo url");
  }

  const metadataDir = `${process.cwd()}/.metadata`;
  const repoSlug = githubUrlValidation.data
    .replace(/^https?:\/\/(www\.)?github\.com\//, "")
    .replace(/\/$/, "")
    .replace(/\//g, "__");
  const jsonlLogPath = `${metadataDir}/${repoSlug}-${Date.now()}.jsonl`;

  await Bun.$`mkdir -p ${metadataDir}`;
  logger.info({ jsonlLogPath }, "Persisting OpenCode event stream to JSONL");

  const jsonlStream = createWriteStream(jsonlLogPath, { flags: "a" });
  const stdoutCapture: JsonLineCapture = {
    buffer: "",
    linesWritten: 0,
  };
  const runSummary: RunSummary = {
    textParts: [],
    toolCalls: new Set(),
  };
  let didFinalizeStdout = false;

  const flushStdout = () => {
    if (didFinalizeStdout) {
      return;
    }

    finalizeJsonLines(stdoutCapture, (line) => {
      consumeOpencodeEvent(runSummary, line);
      jsonlStream.write(`${line}\n`);
    });

    didFinalizeStdout = true;
  };

  try {
    const result = await runAgentAnalysisPipeline({
      githubUrl: githubUrlValidation.data,
      googleApiKey,
      onStdout: (data) => {
        captureJsonLines(stdoutCapture, data, (line) => {
          consumeOpencodeEvent(runSummary, line);
          jsonlStream.write(`${line}\n`);
        });
      },
      onStderr: () => {},
    });

    flushStdout();

    if (result.exitCode !== 0) {
      logger.error(
        {
          exitCode: result.exitCode,
          stderr: result.stderr,
          error: result.error,
          jsonlLogPath,
        },
        "OpenCode run failed",
      );
      throw new Error(result.error ?? result.stderr ?? "OpenCode run failed");
    }

    const rawAnalysis = runSummary.textParts.join(" ").trim();

    if (!rawAnalysis) {
      throw new Error("OpenCode completed without returning analysis text");
    }

    const structuredAnalysis = await parseAgentAnalysis(rawAnalysis, googleApiKey);

    logger.info(
      {
        exitCode: result.exitCode,
        jsonlLogPath,
        eventCount: stdoutCapture.linesWritten,
        sessionId: runSummary.sessionId,
        toolCalls: [...runSummary.toolCalls],
        responseText: rawAnalysis,
        finalStep: runSummary.lastStepFinish,
      },
      "Repository analysis completed",
    );

    logger.info(
      {
        ...structuredAnalysis,
      },
      "Structured analysis generated",
    );

    return {
      rawAnalysis,
      structuredAnalysis,
      jsonlLogPath,
      sessionId: runSummary.sessionId,
      toolCalls: [...runSummary.toolCalls],
      finalStep: runSummary.lastStepFinish,
    } satisfies RunOrchestratorResult;
  } finally {
    flushStdout();
    jsonlStream.end();
    await once(jsonlStream, "finish");
  }
}
