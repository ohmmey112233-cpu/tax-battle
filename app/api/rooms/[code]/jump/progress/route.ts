import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { players, rooms } from "@/db/schema";
import {
  getPlayerByToken,
  getRoomByCode,
  noStoreHeaders,
  normalizeCode,
} from "@/lib/game";

export async function POST(
  request: Request,
  context: { params: Promise<{ code: string }> },
) {
  const { code: rawCode } = await context.params;
  const code = normalizeCode(rawCode);
  const payload = (await request.json().catch(() => ({}))) as {
    playerToken?: string;
    maxHeight?: number;
    energy?: number;
    questionIndex?: number;
  };
  const room = await getRoomByCode(code);
  if (!room) {
    return Response.json({ error: "ไม่พบห้องนี้" }, { status: 404, headers: noStoreHeaders });
  }
  const finalSyncGrace = room.phase === "finished" && Date.now() - room.updatedAt <= 5_000;
  if (room.gameMode !== "jump" || (room.phase !== "jump" && !finalSyncGrace)) {
    return Response.json({ error: "รอบเกมกระโดดสิ้นสุดแล้ว" }, { status: 409, headers: noStoreHeaders });
  }
  if (
    room.gameStartedAt &&
    Date.now() >= room.gameStartedAt + room.gameDurationSeconds * 1000
  ) {
    const db = await getDb();
    await db.update(rooms).set({ phase: "finished", updatedAt: Date.now() }).where(eq(rooms.id, room.id));
  }

  const player = await getPlayerByToken(room.id, payload.playerToken ?? "");
  if (!player) {
    return Response.json({ error: "กรุณาเข้าร่วมห้องใหม่" }, { status: 401, headers: noStoreHeaders });
  }

  const maxHeight = Number.isFinite(payload.maxHeight)
    ? Math.round(Math.max(0, Math.min(100_000, Number(payload.maxHeight))))
    : player.maxHeight;
  const reportedEnergy = Number.isFinite(payload.energy)
    ? Math.round(Math.max(0, Math.min(100, Number(payload.energy))))
    : player.energy;
  // Movement can drain energy, while only a quiz answer is allowed to restore it.
  const energy = payload.questionIndex === player.jumpQuestionIndex
    ? Math.min(player.energy, reportedEnergy)
    : player.energy;
  const db = await getDb();
  await db
    .update(players)
    .set({
      maxHeight: sql`max(${players.maxHeight}, ${maxHeight})`,
      energy,
      lastSeenAt: Date.now(),
    })
    .where(eq(players.id, player.id));

  return Response.json(
    { ok: true, maxHeight: Math.max(player.maxHeight, maxHeight), energy },
    { headers: noStoreHeaders },
  );
}
