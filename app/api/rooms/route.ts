import { getDb } from "@/db";
import { rooms } from "@/db/schema";
import { noStoreHeaders } from "@/lib/game";

function roomCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export async function POST(request: Request) {
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
        maxPlayers: 120,
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
