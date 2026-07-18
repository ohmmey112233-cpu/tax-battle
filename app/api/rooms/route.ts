import { getDb } from "@/db";
import { rooms } from "@/db/schema";
import { noStoreHeaders } from "@/lib/game";
import { QUESTIONS } from "@/lib/questions";

const VALID_COUNTS = [5, 10, 15, 20];
const VALID_SECONDS = [5, 10, 15, 20];

function roomCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as {
    questionCount?: number;
    questionSeconds?: number;
    selectedQuestions?: number[];
  };
  const questionCount = VALID_COUNTS.includes(payload.questionCount ?? 10)
    ? payload.questionCount ?? 10
    : 10;
  const questionSeconds = VALID_SECONDS.includes(payload.questionSeconds ?? 15)
    ? payload.questionSeconds ?? 15
    : 15;
  const selectedQuestions = Array.isArray(payload.selectedQuestions)
    ? [...new Set(payload.selectedQuestions)]
        .filter(
          (index) =>
            Number.isInteger(index) && index >= 0 && index < QUESTIONS.length,
        )
        .sort((a, b) => a - b)
    : Array.from({ length: questionCount }, (_, index) => index);

  if (selectedQuestions.length !== questionCount) {
    return Response.json(
      { error: `กรุณาเลือกคำถามให้ครบ ${questionCount} ข้อ` },
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
        selectedQuestions: JSON.stringify(selectedQuestions),
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
