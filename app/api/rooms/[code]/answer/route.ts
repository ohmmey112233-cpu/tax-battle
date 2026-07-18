import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { answers, players } from "@/db/schema";
import {
  getPlayerByToken,
  getRoomByCode,
  noStoreHeaders,
  normalizeCode,
} from "@/lib/game";
import { QUESTIONS } from "@/lib/questions";

export async function POST(
  request: Request,
  context: { params: Promise<{ code: string }> }
) {
  const { code: rawCode } = await context.params;
  const code = normalizeCode(rawCode);
  const payload = (await request.json()) as {
    playerToken?: string;
    questionIndex?: number;
    answerIndex?: number;
  };

  const room = await getRoomByCode(code);
  if (!room) {
    return Response.json({ error: "ไม่พบห้องนี้" }, { status: 404, headers: noStoreHeaders });
  }
  if (room.phase !== "question") {
    return Response.json(
      { error: "ข้อนี้ปิดรับคำตอบแล้ว" },
      { status: 409, headers: noStoreHeaders }
    );
  }
  if (payload.questionIndex !== room.currentQuestion) {
    return Response.json(
      { error: "คำถามเปลี่ยนแล้ว กรุณารอข้อถัดไป" },
      { status: 409, headers: noStoreHeaders }
    );
  }
  if (!Number.isInteger(payload.answerIndex) || payload.answerIndex! < 0 || payload.answerIndex! > 3) {
    return Response.json(
      { error: "คำตอบไม่ถูกต้อง" },
      { status: 400, headers: noStoreHeaders }
    );
  }

  const player = await getPlayerByToken(room.id, payload.playerToken ?? "");
  if (!player) {
    return Response.json(
      { error: "กรุณาเข้าร่วมห้องใหม่" },
      { status: 401, headers: noStoreHeaders }
    );
  }

  const question = QUESTIONS[room.currentQuestion];
  if (!question || !room.questionStartedAt) {
    return Response.json(
      { error: "คำถามยังไม่พร้อม" },
      { status: 409, headers: noStoreHeaders }
    );
  }

  const now = Date.now();
  const responseMs = Math.max(0, now - room.questionStartedAt);
  if (responseMs > question.seconds * 1000 + 1200) {
    return Response.json(
      { error: "หมดเวลาตอบข้อนี้แล้ว" },
      { status: 409, headers: noStoreHeaders }
    );
  }

  const db = await getDb();
  const [existing] = await db
    .select({ id: answers.id })
    .from(answers)
    .where(
      and(
        eq(answers.roomId, room.id),
        eq(answers.playerId, player.id),
        eq(answers.questionIndex, room.currentQuestion)
      )
    )
    .limit(1);
  if (existing) {
    return Response.json(
      { error: "ตอบข้อนี้ไปแล้ว" },
      { status: 409, headers: noStoreHeaders }
    );
  }

  const isCorrect = payload.answerIndex === question.correctIndex;
  const timeRatio = Math.max(0, 1 - responseMs / (question.seconds * 1000));
  const points = isCorrect ? 500 + Math.round(500 * timeRatio) : 0;

  try {
    await db.insert(answers).values({
      id: crypto.randomUUID(),
      roomId: room.id,
      playerId: player.id,
      questionIndex: room.currentQuestion,
      answerIndex: payload.answerIndex!,
      isCorrect,
      responseMs,
      points,
      answeredAt: now,
    });
    await db
      .update(players)
      .set({
        score: sql`${players.score} + ${points}`,
        correctCount: sql`${players.correctCount} + ${isCorrect ? 1 : 0}`,
        totalResponseMs: sql`${players.totalResponseMs} + ${responseMs}`,
        lastSeenAt: now,
      })
      .where(eq(players.id, player.id));
  } catch {
    return Response.json(
      { error: "ตอบข้อนี้ไปแล้ว" },
      { status: 409, headers: noStoreHeaders }
    );
  }

  return Response.json({ accepted: true, pointsPending: true }, { headers: noStoreHeaders });
}
