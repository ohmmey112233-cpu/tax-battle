import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { answers, players, rooms } from "@/db/schema";
import {
  getRoomByCode,
  noStoreHeaders,
  normalizeCode,
  roomQuestions,
} from "@/lib/game";

type Action = "start" | "reveal" | "next" | "finish" | "reset";

export async function POST(
  request: Request,
  context: { params: Promise<{ code: string }> }
) {
  const { code: rawCode } = await context.params;
  const code = normalizeCode(rawCode);
  const payload = (await request.json()) as { hostToken?: string; action?: Action };
  const room = await getRoomByCode(code);
  if (!room) {
    return Response.json({ error: "ไม่พบห้องนี้" }, { status: 404, headers: noStoreHeaders });
  }
  if (!payload.hostToken || payload.hostToken !== room.hostToken) {
    return Response.json(
      { error: "ไม่มีสิทธิ์ควบคุมห้อง" },
      { status: 403, headers: noStoreHeaders }
    );
  }

  const db = await getDb();
  const now = Date.now();
  const questionCount = roomQuestions(room).length;
  switch (payload.action) {
    case "start":
      await db
        .update(rooms)
        .set({ phase: "question", currentQuestion: 0, questionStartedAt: now, updatedAt: now })
        .where(eq(rooms.id, room.id));
      break;
    case "reveal":
      await db
        .update(rooms)
        .set({ phase: "reveal", updatedAt: now })
        .where(eq(rooms.id, room.id));
      break;
    case "next": {
      const nextQuestion = room.currentQuestion + 1;
      await db
        .update(rooms)
        .set(
          nextQuestion >= questionCount
            ? { phase: "finished", updatedAt: now }
            : {
                phase: "question",
                currentQuestion: nextQuestion,
                questionStartedAt: now,
                updatedAt: now,
              }
        )
        .where(eq(rooms.id, room.id));
      break;
    }
    case "finish":
      await db
        .update(rooms)
        .set({ phase: "finished", updatedAt: now })
        .where(eq(rooms.id, room.id));
      break;
    case "reset":
      await db.delete(answers).where(eq(answers.roomId, room.id));
      await db
        .update(players)
        .set({ score: 0, correctCount: 0, totalResponseMs: 0 })
        .where(eq(players.roomId, room.id));
      await db
        .update(rooms)
        .set({ phase: "lobby", currentQuestion: -1, questionStartedAt: null, updatedAt: now })
        .where(eq(rooms.id, room.id));
      break;
    default:
      return Response.json(
        { error: "คำสั่งไม่ถูกต้อง" },
        { status: 400, headers: noStoreHeaders }
      );
  }

  return Response.json({ ok: true }, { headers: noStoreHeaders });
}
