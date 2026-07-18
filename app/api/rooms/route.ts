import { getDb } from "@/db";
import { rooms } from "@/db/schema";
import { noStoreHeaders } from "@/lib/game";
import { QUESTIONS, type QuizQuestion } from "@/lib/questions";

const VALID_SECONDS = [5, 10, 15, 20];

function customQuestion(value: unknown, seconds: number): QuizQuestion | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as {
    prompt?: unknown;
    options?: unknown;
    correctIndex?: unknown;
    explanation?: unknown;
  };
  const prompt = typeof candidate.prompt === "string" ? candidate.prompt.trim() : "";
  const options = Array.isArray(candidate.options)
    ? candidate.options.map((option) => typeof option === "string" ? option.trim() : "")
    : [];
  if (
    prompt.length < 3 || prompt.length > 300 ||
    options.length !== 4 || options.some((option) => option.length < 1 || option.length > 160) ||
    !Number.isInteger(candidate.correctIndex) ||
    Number(candidate.correctIndex) < 0 || Number(candidate.correctIndex) > 3
  ) return null;

  return {
    prompt,
    options: options as [string, string, string, string],
    correctIndex: Number(candidate.correctIndex),
    seconds,
    explanation: typeof candidate.explanation === "string" && candidate.explanation.trim()
      ? candidate.explanation.trim().slice(0, 500)
      : "คำถามที่ผู้สอนเพิ่มเอง",
  };
}

function roomCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as {
    questionSeconds?: number;
    selectedQuestions?: number[];
    customQuestions?: unknown[];
  };
  const questionSeconds = VALID_SECONDS.includes(payload.questionSeconds ?? 15)
    ? payload.questionSeconds ?? 15
    : 15;
  const selectedIndices = Array.isArray(payload.selectedQuestions)
    ? [...new Set(payload.selectedQuestions)]
        .filter(
          (index) =>
            Number.isInteger(index) && index >= 0 && index < QUESTIONS.length,
        )
        .sort((a, b) => a - b)
    : QUESTIONS.map((_, index) => index);
  const customQuestions = Array.isArray(payload.customQuestions)
    ? payload.customQuestions.map((question) => customQuestion(question, questionSeconds))
    : [];

  if (customQuestions.some((question) => !question)) {
    return Response.json(
      { error: "คำถามที่เพิ่มเองมีข้อมูลไม่ครบหรือยาวเกินกำหนด" },
      { status: 400, headers: noStoreHeaders },
    );
  }
  const questionSet = [
    ...(customQuestions as QuizQuestion[]),
    ...selectedIndices.map((index) => QUESTIONS[index]),
  ];
  const questionCount = questionSet.length;
  if (questionCount < 1 || questionCount > 20) {
    return Response.json(
      { error: "กรุณาเลือกคำถามรวมตั้งแต่ 1 ถึง 20 ข้อ" },
      { status: 400, headers: noStoreHeaders },
    );
  }

  const db = await getDb();
  const now = Date.now();
  const id = crypto.randomUUID();
  const hostToken = crypto.randomUUID();

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = roomCode();
    try {
      await db.insert(rooms).values({
        id,
        code,
        hostToken,
        phase: "lobby",
        currentQuestion: -1,
        questionCount,
        questionSeconds,
        selectedQuestions: JSON.stringify(questionSet),
        maxPlayers: 150,
        createdAt: now,
        updatedAt: now,
      });

      const origin = new URL(request.url).origin;
      return Response.json(
        {
          code,
          hostToken,
          joinUrl: `${origin}/?join=${code}`,
          hostUrl: `${origin}/?host=${code}&token=${hostToken}`,
        },
        { status: 201, headers: noStoreHeaders }
      );
    } catch {
      if (attempt === 7) {
        return Response.json(
          { error: "สร้างห้องไม่สำเร็จ กรุณาลองอีกครั้ง" },
          { status: 500, headers: noStoreHeaders }
        );
      }
    }
  }

  return Response.json(
    { error: "สร้างห้องไม่สำเร็จ" },
    { status: 500, headers: noStoreHeaders }
  );
}
