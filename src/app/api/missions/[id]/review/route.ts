import { z } from "zod";
import { getViewer, unauthorized } from "@/lib/auth";
import { fullSwarmAvailable } from "@/lib/config";
import { storeFor } from "@/lib/store";
import { distillLessons } from "@/lib/learn";
import { describeClaudeError } from "@/lib/claude";

const Body = z
  .object({
    verdict: z.enum(["approve", "reject"]),
    feedback: z.string().trim().max(500).default(""),
  })
  .refine((b) => b.verdict === "approve" || b.feedback.length > 0, {
    message: "Tell your partner what to do differently.",
  });

export async function POST(request: Request, ctx: RouteContext<"/api/missions/[id]/review">) {
  const viewer = await getViewer();
  if (!viewer) return unauthorized();
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid review." }, { status: 400 });
  }
  const { verdict, feedback } = parsed.data;

  const store = storeFor(viewer);
  const mission = await store.getMission(id);
  if (!mission) return Response.json({ error: "Mission not found." }, { status: 404 });
  if (mission.status !== "awaiting_review") {
    return Response.json({ error: "This mission isn't awaiting review." }, { status: 409 });
  }
  const partner = await store.getPartner();
  if (!partner || partner.id !== mission.partnerId) {
    return Response.json({ error: "Partner not found." }, { status: 404 });
  }

  // Free by default: the user's feedback is saved word for word. Distilling it with a
  // paid model happens only in local dev when Full Swarm is explicitly enabled.
  let lessonTexts: string[] = feedback ? [feedback] : [];
  let learnError: string | null = null;
  if (feedback && fullSwarmAvailable()) {
    try {
      const distilled = await distillLessons(partner, mission, verdict, feedback, await store.listLessons());
      lessonTexts = distilled.map((t) => t.slice(0, 500));
    } catch (err) {
      learnError = describeClaudeError(err);
    }
  }

  const lessons = await store.addLessons(
    lessonTexts.map((text) => ({
      partnerId: partner.id,
      missionId: mission.id,
      text,
      source: verdict === "approve" ? "approval" : "correction",
    })),
  );
  const updated = await store.updateMission(mission.id, {
    status: verdict === "approve" ? "approved" : "rejected",
    feedback: feedback || null,
  });

  return Response.json({ mission: updated, lessons, learnError });
}
