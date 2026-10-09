import { z } from "zod";
import { getViewer, unauthorized } from "@/lib/auth";
import { storeFor } from "@/lib/store";

export async function GET() {
  const viewer = await getViewer();
  if (!viewer) return unauthorized();
  const store = storeFor(viewer);
  const [partner, lessons] = await Promise.all([store.getPartner(), store.listLessons()]);
  return Response.json({ partner, lessons });
}

const Body = z.object({
  name: z.string().trim().min(1, "Give your partner a name.").max(40),
  personality: z.string().trim().max(2000),
  standards: z.string().trim().max(6000),
});

export async function PUT(request: Request) {
  const viewer = await getViewer();
  if (!viewer) return unauthorized();
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid partner." },
      { status: 400 },
    );
  }
  return Response.json({ partner: await storeFor(viewer).savePartner(parsed.data) });
}
