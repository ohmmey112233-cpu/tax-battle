import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { answers, players, rooms } from "@/db/schema";
import {
  getPlayerByToken,
  getRoomByCode,
  noStoreHeaders,
  normalizeCode,
  roomQuestions,
} from "@/lib/game";

export async function POST(
  request: Request,
  context: { params: Promise<{ code: string }> },
) {
  const { code: rawCode } = await context.params;
  const code = normalizeCode(rawCode);
  const payload = (await request.json().catch(() => ({}))) as {
    playerToken?: string;
    questionIndex?: number;
    answerIndex?: number;
    responseMs?: number;
  };
  const room = await getRoomByCode(code);
  if (!room) {
    return Response.json({ error: "ไม่พบห้องนี้" }, { status: 404, headers: noStoreHeaders });
  }
  if (room.gameMode !== "jump" || room.phase !== "jump") {
    return Response.json({ error: "รอบเกมกระโดดสิ้นสุดแล้ว" }, { status: 409, headers: noStoreHeaders });
  }
  if (
    room.gameStartedAt &&
    Date.now() >= room.gameStartedAt + room.gameDurationSeconds * 1000
  ) {
    const db = await getDb();
    await db.update(rooms).set({ phase: "finished", updatedAt: Date.now() }).where(eq(rooms.id, room.id));
    return Response.json({ error: "หมดเวลาแล้ว" }, { status: 409, headers: noStoreHeaders });
  }
  const player = await getPlayerByToken(room.id, payload.playerToken ?? "");
  if (!player) {
    return Response.json({ error: "กรุณาเข้าร่วมห้องใหม่" }, { status: 401, headers: noStoreHeaders });
  }
  if (payload.questionIndex !== player.jumpQuestionIndex) {
    return Response.json({ error: "คำถามเปลี่ยนแล้ว กรุณาลองอีกครั้ง" }, { status: 409, headers: noStoreHeaders });
  }
  if (!Number.isInteger(payload.answerIndex) || payload.answerIndex! < -1 || payload.answerIndex! > 3) {
    return Response.json({ error: "คำตอบไม่ถูกต้อง" }, { status: 400, headers: noStoreHeaders });
  }

  const questions = roomQuestions(room);
  const question = questions[player.jumpQuestionIndex % questions.length];
  if (!question) {
    return Response.json({ error: "ไม่พบคำถามในห้องนี้" }, { status: 409, headers: noStoreHeaders });
  }
  const responseMs = Number.isFinite(payload.responseMs)
    ? Math.round(Math.max(0, Math.min(room.questionSeconds * 1000 + 1_000, Number(payload.responseMs))))
    : room.questionSeconds * 1000;
  const isCorrect = payload.answerIndex === question.correctIndex;
  const timeRatio = Math.max(0, 1 - responseMs / (room.questionSeconds * 1000));
  const points = isCorrect ? 300 + Math.round(200 * timeRatio) : 0;
  const energyGain = isCorrect ? 40 : 20;
  const nextEnergy = Math.min(100, player.energy + energyGain);
  const nextQuestionIndex = player.jumpQuestionIndex + 1;
  const nextQuestion = questions[nextQuestionIndex % questions.length];
  const now = Date.now();
  const db = await getDb();

  try {
    await db.insert(answers).values({
      id: crypto.randomUUID(),
      roomId: room.id,
      playerId: player.id,
      questionIndex: player.jumpQuestionIndex,
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
        energy: nextEnergy,
        jumpQuestionIndex: nextQuestionIndex,
        lastSeenAt: now,
      })
      .where(eq(players.id, player.id));
  } catch {
    return Response.json({ error: "ตอบข้อนี้ไปแล้ว" }, { status: 409, headers: noStoreHeaders });
  }

  return Response.json({
    accepted: true,
    isCorrect,
    correctIndex: question.correctIndex,
    explanation: question.explanation,
    points,
    energyGain,
    energy: nextEnergy,
    score: player.score + points,
    correctCount: player.correctCount + (isCorrect ? 1 : 0),
    nextQuestion: {
      index: nextQuestionIndex,
      number: (nextQuestionIndex % questions.length) + 1,
      total: questions.length,
      prompt: nextQuestion.prompt,
      options: nextQuestion.options,
      seconds: room.questionSeconds,
    },
  }, { headers: noStoreHeaders });
}
