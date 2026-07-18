import { and, asc, count, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { answers, players, rooms } from "@/db/schema";
import { QUESTIONS, type QuizQuestion } from "@/lib/questions";

export const noStoreHeaders = {
  "Cache-Control": "no-store, max-age=0",
};

export function normalizeCode(value: string) {
  return value.replace(/\D/g, "").slice(0, 6);
}

export function normalizeNickname(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, 24);
}

export function nicknameKey(value: string) {
  return normalizeNickname(value).toLocaleLowerCase("th-TH");
}

function isStoredQuestion(value: unknown): value is QuizQuestion {
  if (!value || typeof value !== "object") return false;
  const question = value as Partial<QuizQuestion>;
  return (
    typeof question.prompt === "string" &&
    Array.isArray(question.options) &&
    question.options.length === 4 &&
    question.options.every((option) => typeof option === "string") &&
    Number.isInteger(question.correctIndex) &&
    question.correctIndex! >= 0 &&
    question.correctIndex! <= 3 &&
    typeof question.explanation === "string"
  );
}

export function roomQuestions(room: {
  selectedQuestions: string;
  questionCount: number;
}) {
  try {
    const parsed = JSON.parse(room.selectedQuestions) as unknown;
    if (!Array.isArray(parsed)) throw new Error("invalid question list");
    if (parsed.length === room.questionCount && parsed.every(isStoredQuestion)) {
      return parsed;
    }
    const indices = parsed.filter(
      (value): value is number =>
        Number.isInteger(value) && value >= 0 && value < QUESTIONS.length,
    );
    if (indices.length === room.questionCount) return indices.map((index) => QUESTIONS[index]);
  } catch {
    // Older or malformed rooms fall back to the first configured questions.
  }
  return QUESTIONS.slice(0, Math.min(room.questionCount || 10, QUESTIONS.length));
}

export async function getRoomByCode(code: string) {
  const db = await getDb();
  const [room] = await db.select().from(rooms).where(eq(rooms.code, code)).limit(1);
  return room ?? null;
}

export async function getPlayerByToken(roomId: string, token: string) {
  if (!token) return null;
  const db = await getDb();
  const [player] = await db
    .select()
    .from(players)
    .where(and(eq(players.roomId, roomId), eq(players.token, token)))
    .limit(1);
  return player ?? null;
}

export async function getRoomSnapshot(
  code: string,
  options: { hostToken?: string; playerToken?: string } = {}
) {
  const db = await getDb();
  let room = await getRoomByCode(code);
  if (!room) return null;

  const questions = roomQuestions(room);
  const question = questions[room.currentQuestion];
  if (
    room.phase === "question" &&
    question &&
    room.questionStartedAt &&
    Date.now() >= room.questionStartedAt + room.questionSeconds * 1000
  ) {
    await db
      .update(rooms)
      .set({ phase: "reveal", updatedAt: Date.now() })
      .where(and(eq(rooms.id, room.id), eq(rooms.phase, "question")));
    room = { ...room, phase: "reveal" };
  }

  const isHost = Boolean(options.hostToken && options.hostToken === room.hostToken);
  const player = options.playerToken
    ? await getPlayerByToken(room.id, options.playerToken)
    : null;

  if (player) {
    await db
      .update(players)
      .set({ lastSeenAt: Date.now() })
      .where(eq(players.id, player.id));
  }

  const [{ value: playerCount }] = await db
    .select({ value: count() })
    .from(players)
    .where(eq(players.roomId, room.id));

  const [{ value: answeredCount }] = room.currentQuestion >= 0
    ? await db
        .select({ value: count() })
        .from(answers)
        .where(
          and(
            eq(answers.roomId, room.id),
            eq(answers.questionIndex, room.currentQuestion)
          )
        )
    : [{ value: 0 }];

  const leaderboard = await db
    .select({
      id: players.id,
      nickname: players.nickname,
      score: players.score,
      correctCount: players.correctCount,
      totalResponseMs: players.totalResponseMs,
    })
    .from(players)
    .where(eq(players.roomId, room.id))
    .orderBy(desc(players.score), desc(players.correctCount), asc(players.totalResponseMs))
    .limit(isHost || room.phase === "finished" ? room.maxPlayers : 10);

  let myAnswer = null;
  if (player && room.currentQuestion >= 0) {
    const [answer] = await db
      .select()
      .from(answers)
      .where(
        and(
          eq(answers.roomId, room.id),
          eq(answers.playerId, player.id),
          eq(answers.questionIndex, room.currentQuestion)
        )
      )
      .limit(1);
    myAnswer = answer ?? null;
  }

  const publicQuestion = question
    ? {
        index: room.currentQuestion,
        number: room.currentQuestion + 1,
        total: questions.length,
        prompt: question.prompt,
        options: question.options,
        seconds: room.questionSeconds,
        startedAt: room.questionStartedAt,
        ...(room.phase !== "question"
          ? { correctIndex: question.correctIndex, explanation: question.explanation }
          : {}),
      }
    : null;

  return {
    room: {
      code: room.code,
      phase: room.phase,
      currentQuestion: room.currentQuestion,
      questionCount: questions.length,
      questionSeconds: room.questionSeconds,
      maxPlayers: room.maxPlayers,
      playerCount,
      answeredCount,
    },
    question: publicQuestion,
    leaderboard,
    player: player
      ? {
          id: player.id,
          nickname: player.nickname,
          score: player.score,
          correctCount: player.correctCount,
        }
      : null,
    myAnswer,
    isHost,
  };
}
