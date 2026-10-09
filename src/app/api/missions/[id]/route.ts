import { getViewer, unauthorized } from "@/lib/auth";
import { storeFor } from "@/lib/store";

export async function GET(_request: Request, ctx: RouteContext<"/api/missions/[id]">) {
  const viewer = await getViewer();
  if (!viewer) return unauthorized();
  const { id } = await ctx.params;
  const store = storeFor(viewer);
  // Another user's mission id returns 404 here: their row is invisible to this user.
  const mission = await store.getMission(id);
  if (!mission) return Response.json({ error: "Mission not found." }, { status: 404 });
  const lessons = await store.listLessons();
  const applied = lessons.filter((l) => mission.appliedLessonIds.includes(l.id));
  const learned = lessons.filter((l) => l.missionId === mission.id);
  return Response.json({ mission, applied, learned });
}
