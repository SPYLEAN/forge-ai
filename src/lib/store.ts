import "server-only";
import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Viewer } from "./auth";
import { AGENTS, type AgentRole, type Gates, type Lesson, type Mission, type Partner } from "./types";

/**
 * Per-user persistence for partners, missions and lessons.
 *
 * Supabase mode runs every query through the signed-in user's session, so
 * row-level security (supabase/schema.sql) is the real boundary between users.
 * Local mode stores everything in .forge-data/db.json for development only.
 */
export interface Store {
  getPartner(): Promise<Partner | null>;
  savePartner(input: PartnerInput): Promise<Partner>;
  listMissions(): Promise<Mission[]>;
  getMission(id: string): Promise<Mission | null>;
  createMission(input: NewMission): Promise<Mission>;
  updateMission(id: string, patch: MissionPatch): Promise<Mission>;
  listLessons(): Promise<Lesson[]>;
  addLessons(lessons: NewLesson[]): Promise<Lesson[]>;
  deleteLesson(id: string): Promise<void>;
}

export type PartnerInput = Pick<Partner, "name" | "personality" | "standards">;
export type NewMission = Pick<Mission, "partnerId" | "brief" | "mode" | "provider" | "appliedLessonIds">;
export type MissionPatch = Partial<Pick<Mission, "status" | "outputs" | "gates" | "feedback" | "error">>;
export type NewLesson = Pick<Lesson, "partnerId" | "missionId" | "text" | "source">;

export function storeFor(viewer: Viewer): Store {
  return viewer.db ? new SupabaseStore(viewer.db, viewer.userId) : new LocalStore(viewer.userId);
}

const now = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// Local JSON file (development only)
// ---------------------------------------------------------------------------

type Owned<T> = T & { userId: string };
export type LocalUsageRow = {
  id: string;
  userId: string;
  usageDate: string;
  provider: string;
  requestCount: number;
  inputUnits: number;
  outputUnits: number;
  missionId: string | null;
  status: "reserved" | "succeeded" | "failed";
  success: boolean | null;
  ipHash: string;
  createdAt: string;
};
type Db = {
  partners: Owned<Partner>[];
  missions: Owned<Mission>[];
  lessons: Owned<Lesson>[];
  usage: LocalUsageRow[];
};

class LocalDb {
  private file = path.join(process.cwd(), ".forge-data", "db.json");
  // Serialize every read-modify-write so concurrent requests can't clobber each other.
  // This is also what makes local quota claims atomic.
  private queue: Promise<unknown> = Promise.resolve();

  async read(): Promise<Db> {
    try {
      const db = JSON.parse(await fs.readFile(this.file, "utf8")) as Partial<Db>;
      return { partners: [], missions: [], lessons: [], usage: [], ...db };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return { partners: [], missions: [], lessons: [], usage: [] };
      }
      throw err;
    }
  }

  mutate<T>(fn: (db: Db) => T): Promise<T> {
    const run = this.queue.then(async () => {
      const db = await this.read();
      const result = fn(db);
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(db, null, 2));
      await fs.rename(tmp, this.file);
      return result;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
}

export const localDb = new LocalDb();

function strip<T extends { userId: string }>(row: T): Omit<T, "userId"> {
  const { userId: _ignored, ...rest } = row;
  void _ignored;
  return rest;
}

class LocalStore implements Store {
  constructor(private userId: string) {}

  async getPartner() {
    const p = (await localDb.read()).partners.find((x) => x.userId === this.userId);
    return p ? strip(p) : null;
  }

  savePartner(input: PartnerInput) {
    return localDb.mutate((db) => {
      const existing = db.partners.find((x) => x.userId === this.userId);
      if (existing) {
        Object.assign(existing, input, { updatedAt: now() });
        return strip(existing);
      }
      const p = { id: randomUUID(), userId: this.userId, ...input, createdAt: now(), updatedAt: now() };
      db.partners.push(p);
      return strip(p);
    });
  }

  async listMissions() {
    return (await localDb.read()).missions
      .filter((m) => m.userId === this.userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(strip);
  }

  async getMission(id: string) {
    const m = (await localDb.read()).missions.find((x) => x.id === id && x.userId === this.userId);
    return m ? strip(m) : null;
  }

  createMission(input: NewMission) {
    return localDb.mutate((db) => {
      const m = {
        id: randomUUID(),
        userId: this.userId,
        ...input,
        status: "running" as const,
        outputs: {},
        gates: null,
        feedback: null,
        error: null,
        createdAt: now(),
        updatedAt: now(),
      };
      db.missions.push(m);
      return strip(m);
    });
  }

  updateMission(id: string, patch: MissionPatch) {
    return localDb.mutate((db) => {
      const m = db.missions.find((x) => x.id === id && x.userId === this.userId);
      if (!m) throw new Error("Mission not found");
      Object.assign(m, patch, { updatedAt: now() });
      return strip(m);
    });
  }

  async listLessons() {
    return (await localDb.read()).lessons
      .filter((l) => l.userId === this.userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(strip);
  }

  addLessons(lessons: NewLesson[]) {
    return localDb.mutate((db) => {
      const created = lessons.map((l) => ({ ...l, id: randomUUID(), userId: this.userId, createdAt: now() }));
      db.lessons.push(...created);
      return created.map(strip);
    });
  }

  async deleteLesson(id: string) {
    await localDb.mutate((db) => {
      db.lessons = db.lessons.filter((l) => !(l.id === id && l.userId === this.userId));
    });
  }
}

// ---------------------------------------------------------------------------
// Supabase (schema: supabase/schema.sql). Every call runs as the user.
// ---------------------------------------------------------------------------

type ProfileRow = {
  id: string;
  name: string;
  personality: string;
  standards: string;
  created_at: string;
  updated_at: string;
};
type MissionRow = {
  id: string;
  profile_id: string;
  brief: string;
  mode: Mission["mode"];
  provider: string;
  status: Mission["status"];
  gates: Gates | null;
  applied_lesson_ids: string[] | null;
  feedback: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  mission_outputs?: { role: AgentRole; content: string }[];
};
type LessonRow = {
  id: string;
  profile_id: string;
  mission_id: string | null;
  text: string;
  source: Lesson["source"];
  created_at: string;
};

const MISSION_COLS =
  "id, profile_id, brief, mode, provider, status, gates, applied_lesson_ids, feedback, error, created_at, updated_at";

const toPartner = (r: ProfileRow): Partner => ({
  id: r.id,
  name: r.name,
  personality: r.personality,
  standards: r.standards,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});
const toMission = (r: MissionRow): Mission => {
  const outputs: Partial<Record<AgentRole, string>> = {};
  for (const o of r.mission_outputs ?? []) if (AGENTS.includes(o.role)) outputs[o.role] = o.content;
  return {
    id: r.id,
    partnerId: r.profile_id,
    brief: r.brief,
    mode: r.mode,
    provider: r.provider,
    status: r.status,
    outputs,
    gates: r.gates,
    appliedLessonIds: r.applied_lesson_ids ?? [],
    feedback: r.feedback,
    error: r.error,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
};
const toLesson = (r: LessonRow): Lesson => ({
  id: r.id,
  partnerId: r.profile_id,
  missionId: r.mission_id,
  text: r.text,
  source: r.source,
  createdAt: r.created_at,
});

function check<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(`Database error: ${res.error.message}`);
  return res.data as T;
}

class SupabaseStore implements Store {
  constructor(
    private db: SupabaseClient,
    private userId: string,
  ) {}

  async getPartner() {
    const row = check<ProfileRow | null>(
      await this.db.from("intelligence_profiles").select("*").eq("user_id", this.userId).maybeSingle(),
    );
    return row ? toPartner(row) : null;
  }

  async savePartner(input: PartnerInput) {
    return toPartner(
      check<ProfileRow>(
        await this.db
          .from("intelligence_profiles")
          .upsert({ user_id: this.userId, ...input, updated_at: now() }, { onConflict: "user_id" })
          .select()
          .single(),
      ),
    );
  }

  async listMissions() {
    return check<MissionRow[]>(
      await this.db
        .from("missions")
        .select(MISSION_COLS)
        .eq("user_id", this.userId)
        .order("created_at", { ascending: false })
        .limit(50),
    ).map(toMission);
  }

  async getMission(id: string) {
    const row = check<MissionRow | null>(
      await this.db
        .from("missions")
        .select(`${MISSION_COLS}, mission_outputs(role, content)`)
        .eq("id", id)
        .maybeSingle(),
    );
    return row ? toMission(row) : null;
  }

  async createMission(input: NewMission) {
    return toMission(
      check<MissionRow>(
        await this.db
          .from("missions")
          .insert({
            user_id: this.userId,
            profile_id: input.partnerId,
            brief: input.brief,
            mode: input.mode,
            provider: input.provider,
            applied_lesson_ids: input.appliedLessonIds,
          })
          .select(MISSION_COLS)
          .single(),
      ),
    );
  }

  async updateMission(id: string, patch: MissionPatch) {
    if (patch.outputs) {
      const rows = Object.entries(patch.outputs).map(([role, content]) => ({
        user_id: this.userId,
        mission_id: id,
        role,
        content,
      }));
      if (rows.length) {
        check(await this.db.from("mission_outputs").upsert(rows, { onConflict: "mission_id,role" }));
      }
    }
    const row: Record<string, unknown> = { updated_at: now() };
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.gates !== undefined) row.gates = patch.gates;
    if (patch.feedback !== undefined) row.feedback = patch.feedback;
    if (patch.error !== undefined) row.error = patch.error;
    check(await this.db.from("missions").update(row).eq("id", id));
    const m = await this.getMission(id);
    if (!m) throw new Error("Mission not found");
    return m;
  }

  async listLessons() {
    return check<LessonRow[]>(
      await this.db
        .from("lessons")
        .select("*")
        .eq("user_id", this.userId)
        .order("created_at", { ascending: false })
        .limit(200),
    ).map(toLesson);
  }

  async addLessons(lessons: NewLesson[]) {
    if (lessons.length === 0) return [];
    return check<LessonRow[]>(
      await this.db
        .from("lessons")
        .insert(
          lessons.map((l) => ({
            user_id: this.userId,
            profile_id: l.partnerId,
            mission_id: l.missionId,
            text: l.text,
            source: l.source,
          })),
        )
        .select(),
    ).map(toLesson);
  }

  async deleteLesson(id: string) {
    check(await this.db.from("lessons").delete().eq("id", id));
  }
}
