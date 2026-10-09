import { z } from "zod";
import { getViewer, unauthorized } from "@/lib/auth";
import { storeFor } from "@/lib/store";

const Add = z.object({ text: z.string().trim().min(3).max(500) });

/** Manually teach the partner a lesson. */
export async function POST(request: Request) {
  const viewer = await getViewer();
  if (!viewer) return unauthorized();
  const parsed = Add.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Write the lesson out (3–500 characters)." }, { status: 400 });
  const store = storeFor(viewer);
  const partner = await store.getPartner();
  if (!partner) return Response.json({ error: "Imprint your partner first." }, { status: 409 });
  const [lesson] = await store.addLessons([
    { partnerId: partner.id, missionId: null, text: parsed.data.text, source: "manual" },
  ]);
  return Response.json({ lesson });
}

export async function DELETE(request: Request) {
  const viewer = await getViewer();
  if (!viewer) return unauthorized();
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "Missing id." }, { status: 400 });
  await storeFor(viewer).deleteLesson(id);
  return new Response(null, { status: 204 });
}
