import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { players } from "@/db/schema";
import {
  getRoomByCode,
  nicknameKey,
  noStoreHeaders,
  normalizeCode,
  normalizeNickname,
} from "@/lib/game";

export async function POST(
  request: Request,
  context: { params: Promise<{ code: string }> }
) {
  const { code: rawCode } = await context.params;
  const code = normalizeCode(rawCode);
  const room = await getRoomByCode(code);
  if (!room) {
    return Response.json({ error: "ไม่พบห้องนี้" }, { status: 404, headers: noStoreHeaders });
  }
  if (room.phase !== "lobby") {
    return Response.json(
      { error: "เกมเริ่มแล้ว ไม่สามารถเข้าร่วมเพิ่มได้" },
      { status: 409, headers: noStoreHeaders }
    );
  }

  const payload = (await request.json()) as { nickname?: string };
  const nickname = normalizeNickname(payload.nickname ?? "");
  if (nickname.length < 2) {
    return Response.json(
      { error: "กรุณาใส่ชื่อเล่นอย่างน้อย 2 ตัวอักษร" },
      { status: 400, headers: noStoreHeaders }
    );
  }

  const db = await getDb();
  const key = nicknameKey(nickname);
  const [duplicate] = await db
    .select({ id: players.id })
    .from(players)
    .where(and(eq(players.roomId, room.id), eq(players.nicknameKey, key)))
    .limit(1);
  if (duplicate) {
    return Response.json(
      { error: "ชื่อเล่นนี้มีคนใช้แล้ว กรุณาเปลี่ยนชื่อ" },
      { status: 409, headers: noStoreHeaders }
    );
  }

  const id = crypto.randomUUID();
  const token = crypto.randomUUID();
  const now = Date.now();
  try {
    const inserted = await db.run(sql`
      INSERT INTO players (
        id, room_id, nickname, nickname_key, token,
        score, correct_count, total_response_ms, joined_at, last_seen_at
      )
      SELECT
        ${id}, ${room.id}, ${nickname}, ${key}, ${token},
        0, 0, 0, ${now}, ${now}
      WHERE (
        SELECT COUNT(*) FROM players WHERE room_id = ${room.id}
      ) < ${room.maxPlayers}
    `);
    if (inserted.meta.changes === 0) {
      return Response.json(
        { error: `ห้องเต็มแล้ว (สูงสุด ${room.maxPlayers} คน)` },
        { status: 409, headers: noStoreHeaders },
      );
    }
  } catch {
    return Response.json(
      { error: "เข้าร่วมห้องไม่สำเร็จ กรุณาเปลี่ยนชื่อแล้วลองใหม่" },
      { status: 409, headers: noStoreHeaders }
    );
  }

  return Response.json(
    { playerId: id, playerToken: token, nickname, code },
    { status: 201, headers: noStoreHeaders }
  );
}
