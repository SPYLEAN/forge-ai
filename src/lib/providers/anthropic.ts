import "server-only";
import { AGENT_SPECS, agentInput } from "../agents";
import { MODEL, describeClaudeError, getClaude } from "../claude";
import { splitGates } from "../gates";
import { AGENTS, type AgentRole } from "../types";
import { ProviderError, SwarmResultSchema, type SwarmProvider } from "./types";

/**
 * Full Swarm: four sequential Claude calls, Architect → Builder → Critic → Witness.
 * PAID. Only reachable when fullSwarmAvailable() is true (local dev, explicit opt-in,
 * the developer's own key). There's no server-side fallback model and no SDK retries,
 * so every request is one the developer chose to pay for.
 */
export const anthropicProvider: SwarmProvider = {
  id: "anthropic",
  label: "Anthropic Claude",
  model: MODEL,

  async run({ preamble, brief, signal, emit }) {
    const claude = getClaude();
    const outputs: Partial<Record<AgentRole, string>> = {};
    const usage = { inputUnits: 0, outputUnits: 0 };

    for (const role of AGENTS) {
      const spec = AGENT_SPECS[role];
      emit({ type: "agent_start", agent: role });
      let text = "";
      try {
        const stream = claude.messages.stream(
          {
            model: MODEL,
            max_tokens: 32000,
            thinking: { type: "adaptive" },
            output_config: { effort: spec.effort },
            system: `${preamble}\n\n# Your role\n${spec.instructions}`,
            messages: [{ role: "user", content: agentInput(role, brief, outputs) }],
          },
          { signal },
        );
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            text += event.delta.text;
            emit({ type: "delta", agent: role, text: event.delta.text });
          }
        }
        const final = await stream.finalMessage();
        usage.inputUnits += final.usage.input_tokens;
        usage.outputUnits += final.usage.output_tokens;
        if (final.stop_reason === "refusal") {
          throw new ProviderError(`The ${spec.title} declined this mission. Try rephrasing the brief.`, "upstream", usage);
        }
        if (final.stop_reason === "max_tokens") text += "\n\n> ⚠️ Output was cut off at the token limit.";
      } catch (err) {
        if (err instanceof ProviderError) throw err;
        throw new ProviderError(describeClaudeError(err), "upstream", usage);
      }
      outputs[role] = text;
      emit({ type: "agent_done", agent: role });
    }

    const { body, gates } = splitGates(outputs.witness ?? "");
    const parsed = SwarmResultSchema.safeParse({ ...outputs, witness: body, gates });
    if (!parsed.success) throw new ProviderError("A specialist returned no output.", "bad_output", usage);
    return { result: parsed.data, usage };
  },
};
