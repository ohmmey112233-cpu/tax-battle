import { getRoomSnapshot, noStoreHeaders, normalizeCode } from "@/lib/game";

export async function GET(
  request: Request,
  context: { params: Promise<{ code: string }> }
) {
  const { code: rawCode } = await context.params;
  const code = normalizeCode(rawCode);
  const url = new URL(request.url);
  const snapshot = await getRoomSnapshot(code, {
    hostToken: url.searchParams.get("hostToken") ?? undefined,
    playerToken: url.searchParams.get("playerToken") ?? undefined,
  });

  if (!snapshot) {
    return Response.json(
      { error: "ไม่พบห้องนี้" },
      { status: 404, headers: noStoreHeaders }
    );
  }

  return Response.json(snapshot, { headers: noStoreHeaders });
}
