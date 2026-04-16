import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateObject, generateText, Output } from "ai";
import { z } from "zod";

const AgentAnalysisSchema = z.object({
  classification: z.enum(["AGENT", "POSSIBLE_AGENT", "NOT_AGENT"]),
  confidence: z.enum(["high", "medium", "low"]),
  agentSignals: z.array(z.string()),
  evidenceFiles: z.array(z.string()),
  frameworksDetected: z.array(z.string()),
  reasoning: z.string(),
});

export type AgentAnalysis = z.infer<typeof AgentAnalysisSchema>;

export async function parseAgentAnalysis(
  analysisText: string,
  googleApiKey: string,
) {
  const google = createGoogleGenerativeAI({ apiKey: googleApiKey });

  const { output } = await generateText({
    model: google("gemini-2.5-flash"),
    output: Output.object({ schema: AgentAnalysisSchema }),
    system:
      "Convert the provided repository analysis report into structured data. Preserve the original meaning, do not add new claims, and use empty arrays when a list section is missing.",
    prompt: [
      "Parse this repository analysis report into the requested schema:",
      analysisText,
    ].join("\n\n"),
  });

  return output;
}
