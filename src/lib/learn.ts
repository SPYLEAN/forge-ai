import "server-only";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { getClaude, MODEL } from "./claude";
import type { Lesson, Mission, Partner } from "./types";

const Distilled = z.object({
  lessons: z
    .array(z.string())
    .describe("0-3 durable, reusable rules, each one imperative sentence"),
});

/**
 * Turn one piece of review feedback into durable rules the partner applies to
 * every future mission. This is the "Learn" step: there's no model training,
 * just memory that gets retrieved into later prompts.
 */
export async function distillLessons(
  partner: Partner,
  mission: Mission,
  verdict: "approve" | "reject",
  feedback: string,
  existing: Lesson[],
): Promise<string[]> {
  const res = await getClaude().messages.parse({
    model: MODEL,
    max_tokens: 4000,
    output_config: { effort: "low", format: zodOutputFormat(Distilled) },
    system: `You maintain the long-term memory of ${partner.name}, a personal AI coding partner. Turn the user's review feedback into durable lessons that will improve future work on *other* missions.

Rules:
- Each lesson is one imperative sentence a developer could follow, such as "Validate request bodies with zod at every API boundary."
- Generalize beyond this one mission, but keep the user's actual preference. Don't soften it or add to it.
- Skip anything one-off, purely about this specific task, or already covered by an existing lesson.
- Return an empty list if nothing is durable.`,
    messages: [
      {
        role: "user",
        content: `Existing lessons:\n${existing.map((l) => `- ${l.text}`).join("\n") || "(none)"}

Mission brief:\n${mission.brief}

Critic's verdict excerpt:\n${(mission.outputs.critic ?? "").slice(-1500)}

User ${verdict === "approve" ? "APPROVED" : "REJECTED"} the result with this feedback:\n${feedback}`,
      },
    ],
  });
  return (res.parsed_output?.lessons ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 3);
}
