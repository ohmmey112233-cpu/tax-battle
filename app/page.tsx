"use client";

import QRCode from "qrcode";
import Image from "next/image";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type Phase = "lobby" | "question" | "reveal" | "finished";

type LeaderboardRow = {
  id: string;
  nickname: string;
  score: number;
  correctCount: number;
  totalResponseMs: number;
};

type Snapshot = {
  room: {
    code: string;
    phase: Phase;
    currentQuestion: number;
    maxPlayers: number;
    playerCount: number;
    answeredCount: number;
  };
  question: null | {
    index: number;
    number: number;
    total: number;
    prompt: string;
    options: string[];
    seconds: number;
    startedAt: number | null;
    correctIndex?: number;
    explanation?: string;
  };
  leaderboard: LeaderboardRow[];
  player: null | {
    id: string;
    nickname: string;
    score: number;
    correctCount: number;
  };
  myAnswer: null | {
    answerIndex: number;
    isCorrect: boolean;
    points: number;
    responseMs: number;
  };
  isHost: boolean;
};

type Screen =
  | { type: "home" }
  | { type: "join"; code: string }
  | { type: "host"; code: string; token: string }
  | { type: "player"; code: string; token: string };

const ANSWER_STYLES = ["answer-red", "answer-blue", "answer-amber", "answer-green"];
const ANSWER_ICONS = ["▲", "◆", "●", "■"];

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "เกิดข้อผิดพลาด กรุณาลองใหม่");
  return body;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("th-TH").format(value);
}

function Brand() {
  return (
    <button className="brand" onClick={() => (window.location.href = "/")} aria-label="กลับหน้าหลัก">
      <span className="brand-mark">TB</span>
      <span>Tax Battle</span>
    </button>
  );
}

function StatusPill({ children, tone = "teal" }: { children: React.ReactNode; tone?: string }) {
  return <span className={`status-pill status-${tone}`}>{children}</span>;
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="error-banner" role="alert">
      <span>!</span>
      {message}
    </div>
  );
}

function HomeScreen({ onJoin }: { onJoin: (code: string) => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function createRoom() {
    setBusy(true);
    setError("");
    try {
      const room = await readJson<{ code: string; hostToken: string }>(
        await fetch("/api/rooms", { method: "POST" })
      );
      localStorage.setItem(`tax-battle-host-${room.code}`, room.hostToken);
      window.location.href = `/?host=${room.code}&token=${room.hostToken}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : "สร้างห้องไม่สำเร็จ");
      setBusy(false);
    }
  }

  function submitCode(event: FormEvent) {
    event.preventDefault();
    const clean = code.replace(/\D/g, "").slice(0, 6);
    if (clean.length !== 6) {
      setError("กรุณาใส่รหัสห้อง 6 หลัก");
      return;
    }
    onJoin(clean);
  }

  return (
    <main className="home-shell">
      <nav className="topbar">
        <Brand />
        <StatusPill>20 คำถาม · สูงสุด 120 คน</StatusPill>
      </nav>

      <section className="hero-grid">
        <div className="hero-copy">
          <p className="eyebrow">QUIZ เรื่องภาษี ปี 2569</p>
          <h1>เรียนภาษีให้สนุก<br />แล้วมาวัดกันที่ความเร็ว</h1>
          <p className="hero-lede">
            ตอบถูกได้คะแนน ตอบเร็วได้คะแนนเพิ่ม พร้อมอันดับสดหลังจบทุกข้อ
          </p>
          <div className="hero-stats" aria-label="รายละเอียดเกม">
            <div><strong>20</strong><span>คำถาม</span></div>
            <div><strong>120</strong><span>ผู้เล่น</span></div>
            <div><strong>1,000</strong><span>คะแนนสูงสุด/ข้อ</span></div>
          </div>
        </div>

        <div className="entry-stack">
          <form className="entry-card join-card" onSubmit={submitCode}>
            <div className="card-kicker"><span className="live-dot" /> ผู้เล่น</div>
            <h2>เข้าร่วมการแข่งขัน</h2>
            <label htmlFor="room-code">รหัสห้อง 6 หลัก</label>
            <input
              id="room-code"
              className="room-code-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            />
            <button className="primary-button" type="submit">เข้าห้อง</button>
          </form>

          <div className="entry-card host-card">
            <div>
              <div className="card-kicker">ผู้สอน</div>
              <h2>สร้างห้องใหม่</h2>
              <p>ระบบจะสร้างรหัสและ QR Code ให้ทันที</p>
            </div>
            <button className="secondary-button" onClick={createRoom} disabled={busy}>
              {busy ? "กำลังสร้าง…" : "สร้างห้องสำหรับผู้สอน"}
            </button>
          </div>
          {error && <ErrorBanner message={error} />}
        </div>
      </section>

      <footer className="site-footer">
        <span>Tax Battle</span>
        <span>ตอบถูก + ตอบเร็ว = คะแนนมากกว่า</span>
      </footer>
    </main>
  );
}

function JoinScreen({ code, onJoined }: { code: string; onJoined: (token: string) => void }) {
  const [nickname, setNickname] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function join(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const joined = await readJson<{ playerToken: string }>(
        await fetch(`/api/rooms/${code}/join`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nickname }),
        })
      );
      localStorage.setItem(`tax-battle-player-${code}`, joined.playerToken);
      onJoined(joined.playerToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : "เข้าร่วมห้องไม่สำเร็จ");
      setBusy(false);
    }
  }

  return (
    <main className="center-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <section className="join-panel">
        <Brand />
        <div className="room-badge">ห้อง {code}</div>
        <h1>พร้อมเข้าร่วม Tax Battle?</h1>
        <p>ใส่ชื่อเล่นที่เพื่อนจำได้ แล้วรอผู้สอนเริ่มเกม</p>
        <form onSubmit={join}>
          <label htmlFor="nickname">ชื่อเล่น</label>
          <input
            id="nickname"
            autoFocus
            maxLength={24}
            placeholder="เช่น น้องฟ้า"
            value={nickname}
            onChange={(event) => setNickname(event.target.value)}
          />
          <button className="primary-button" disabled={busy}>
            {busy ? "กำลังเข้าห้อง…" : "เข้าร่วมเกม"}
          </button>
        </form>
        {error && <ErrorBanner message={error} />}
        <button className="text-button" onClick={() => (window.location.href = "/")}>เปลี่ยนรหัสห้อง</button>
      </section>
    </main>
  );
}

function Leaderboard({ rows, full = false }: { rows: LeaderboardRow[]; full?: boolean }) {
  if (!rows.length) return <div className="empty-state">ยังไม่มีคะแนน</div>;
  return (
    <div className={`leaderboard ${full ? "leaderboard-full" : ""}`}>
      {rows.map((row, index) => (
        <div className={`leader-row rank-${index + 1}`} key={row.id}>
          <span className="rank-number">{index + 1}</span>
          <span className="leader-name">{row.nickname}</span>
          <span className="leader-correct">ถูก {row.correctCount}</span>
          <strong>{formatNumber(row.score)}</strong>
        </div>
      ))}
    </div>
  );
}

function Timer({ startedAt, seconds }: { startedAt: number | null; seconds: number }) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(timer);
  }, []);
  const effectiveNow = now || startedAt || 0;
  const remaining = startedAt
    ? Math.min(seconds, Math.max(0, seconds - (effectiveNow - startedAt) / 1000))
    : seconds;
  const percent = Math.max(0, (remaining / seconds) * 100);
  return (
    <div className="timer" aria-label={`เหลือเวลา ${Math.ceil(remaining)} วินาที`}>
      <div className="timer-ring" style={{ "--timer": `${percent * 3.6}deg` } as React.CSSProperties}>
        <strong>{Math.ceil(remaining)}</strong><span>วิ</span>
      </div>
    </div>
  );
}

function QuestionBoard({ snapshot, host = false, onAnswer, answering }: {
  snapshot: Snapshot;
  host?: boolean;
  onAnswer?: (index: number) => void;
  answering?: boolean;
}) {
  const q = snapshot.question;
  if (!q) return null;
  const locked = Boolean(snapshot.myAnswer || answering || snapshot.room.phase !== "question");
  return (
    <section className="question-board">
      <header className="question-meta">
        <StatusPill tone="navy">ข้อ {q.number}/{q.total}</StatusPill>
        {snapshot.room.phase === "question" ? (
          <span>{snapshot.room.answeredCount}/{snapshot.room.playerCount} คนตอบแล้ว</span>
        ) : (
          <StatusPill tone="lime">เฉลย</StatusPill>
        )}
      </header>
      <div className="question-line">
        <h1>{q.prompt}</h1>
        {snapshot.room.phase === "question" && <Timer startedAt={q.startedAt} seconds={q.seconds} />}
      </div>
      <div className="answer-grid">
        {q.options.map((option, index) => {
          const isCorrect = q.correctIndex === index;
          const isMine = snapshot.myAnswer?.answerIndex === index;
          return (
            <button
              className={`answer-option ${ANSWER_STYLES[index]} ${isCorrect ? "is-correct" : ""} ${isMine ? "is-mine" : ""}`}
              key={option}
              onClick={() => onAnswer?.(index)}
              disabled={host || locked}
            >
              <span className="answer-icon">{ANSWER_ICONS[index]}</span>
              <span>{option}</span>
              {snapshot.room.phase !== "question" && isCorrect && <span className="answer-check">✓</span>}
            </button>
          );
        })}
      </div>
      {snapshot.room.phase !== "question" && q.explanation && (
        <div className="explanation"><strong>จำไว้:</strong> {q.explanation}</div>
      )}
    </section>
  );
}

function useSnapshot(code: string, kind: "host" | "player", token: string) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const key = kind === "host" ? "hostToken" : "playerToken";
      const response = await fetch(`/api/rooms/${code}?${key}=${encodeURIComponent(token)}`, {
        cache: "no-store",
      });
      const data = await readJson<Snapshot>(response);
      setSnapshot(data);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "เชื่อมต่อเกมไม่สำเร็จ");
    }
  }, [code, kind, token]);

  useEffect(() => {
    const firstRefresh = window.setTimeout(refresh, 0);
    const timer = window.setInterval(refresh, 1000);
    return () => {
      window.clearTimeout(firstRefresh);
      window.clearInterval(timer);
    };
  }, [refresh]);

  return { snapshot, error, refresh };
}

function HostScreen({ code, token }: { code: string; token: string }) {
  const { snapshot, error, refresh } = useSnapshot(code, "host", token);
  const [qr, setQr] = useState("");
  const [busy, setBusy] = useState(false);
  const joinUrl = useMemo(() => (typeof window === "undefined" ? "" : `${window.location.origin}/?join=${code}`), [code]);

  useEffect(() => {
    if (!joinUrl) return;
    QRCode.toDataURL(joinUrl, {
      width: 420,
      margin: 2,
      errorCorrectionLevel: "H",
      color: { dark: "#073b4c", light: "#ffffff" },
    }).then(setQr);
  }, [joinUrl]);

  async function control(action: string) {
    setBusy(true);
    try {
      await readJson(await fetch(`/api/rooms/${code}/control`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hostToken: token, action }),
      }));
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!snapshot) {
    return <main className="loading-screen"><Brand /><div className="loading-orbit" />{error && <ErrorBanner message={error} />}</main>;
  }
  if (!snapshot.isHost) return <main className="loading-screen"><ErrorBanner message="ลิงก์ผู้สอนไม่ถูกต้อง" /></main>;

  const phase = snapshot.room.phase;
  return (
    <main className="game-shell host-shell">
      <nav className="game-topbar">
        <Brand />
        <div className="topbar-actions">
          <span className="connection-dot">ออนไลน์</span>
          <StatusPill tone="navy">ห้อง {code}</StatusPill>
        </div>
      </nav>

      {error && <ErrorBanner message={error} />}

      {phase === "lobby" && (
        <section className="host-lobby">
          <div className="host-invite">
            <p className="eyebrow">ให้นักศึกษาสแกนเพื่อเข้าร่วม</p>
            <h1>ห้อง <span>{code}</span></h1>
            <div className="qr-frame">{qr ? <Image src={qr} alt={`QR Code เข้าห้อง ${code}`} width={420} height={420} unoptimized /> : <div className="qr-loading" />}</div>
            <button className="copy-link" onClick={() => navigator.clipboard.writeText(joinUrl)}>คัดลอกลิงก์เข้าห้อง</button>
          </div>
          <div className="lobby-roster">
            <div className="roster-heading">
              <div><p>ผู้เล่นพร้อมแล้ว</p><strong>{snapshot.room.playerCount}<small>/120</small></strong></div>
              <StatusPill tone="lime">กำลังรอ</StatusPill>
            </div>
            <div className="roster-list">
              {snapshot.leaderboard.length ? snapshot.leaderboard.map((player) => (
                <span key={player.id}>{player.nickname}</span>
              )) : <div className="empty-roster"><span>↗</span>รายชื่อจะปรากฏที่นี่</div>}
            </div>
            <button className="start-button" onClick={() => control("start")} disabled={busy}>
              เริ่มเกม 20 ข้อ <span>→</span>
            </button>
          </div>
        </section>
      )}

      {(phase === "question" || phase === "reveal") && (
        <>
          <QuestionBoard snapshot={snapshot} host />
          <div className="host-controlbar">
            <div className="control-stat">
              <span>คำตอบ</span><strong>{snapshot.room.answeredCount}/{snapshot.room.playerCount}</strong>
            </div>
            {phase === "question" ? (
              <button className="reveal-button" onClick={() => control("reveal")} disabled={busy}>ปิดรับและเฉลย</button>
            ) : (
              <button className="start-button compact" onClick={() => control("next")} disabled={busy}>
                {snapshot.question?.number === snapshot.question?.total ? "ดูผลลัพธ์สุดท้าย" : "คำถามถัดไป"} <span>→</span>
              </button>
            )}
          </div>
          {phase === "reveal" && (
            <section className="mini-ranking">
              <h2>อันดับล่าสุด</h2>
              <Leaderboard rows={snapshot.leaderboard.slice(0, 5)} />
            </section>
          )}
        </>
      )}

      {phase === "finished" && (
        <section className="results-layout">
          <div className="results-title">
            <p className="eyebrow">FINAL SCORE</p>
            <h1>สุดยอดนักวางแผนภาษี</h1>
            <p>คะแนนรวมจากความถูกต้องและความเร็วทั้ง 20 ข้อ</p>
            <button className="secondary-button" onClick={() => control("reset")} disabled={busy}>เล่นอีกรอบ</button>
          </div>
          <Leaderboard rows={snapshot.leaderboard} full />
        </section>
      )}
    </main>
  );
}

function PlayerScreen({ code, token }: { code: string; token: string }) {
  const { snapshot, error, refresh } = useSnapshot(code, "player", token);
  const [answering, setAnswering] = useState(false);
  const [answerError, setAnswerError] = useState("");

  async function answer(index: number) {
    if (!snapshot?.question || snapshot.myAnswer) return;
    setAnswering(true);
    setAnswerError("");
    try {
      await readJson(await fetch(`/api/rooms/${code}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerToken: token,
          questionIndex: snapshot.question.index,
          answerIndex: index,
        }),
      }));
      await refresh();
    } catch (err) {
      setAnswerError(err instanceof Error ? err.message : "ส่งคำตอบไม่สำเร็จ");
    } finally {
      setAnswering(false);
    }
  }

  if (!snapshot) return <main className="loading-screen"><Brand /><div className="loading-orbit" />{error && <ErrorBanner message={error} />}</main>;
  const { phase } = snapshot.room;

  return (
    <main className="game-shell player-shell">
      <nav className="game-topbar">
        <Brand />
        <div className="player-summary">
          <span>{snapshot.player?.nickname}</span>
          <strong>{formatNumber(snapshot.player?.score ?? 0)} คะแนน</strong>
        </div>
      </nav>

      {(error || answerError) && <ErrorBanner message={error || answerError} />}

      {phase === "lobby" && (
        <section className="waiting-card">
          <div className="waiting-pulse"><span>✓</span></div>
          <p className="eyebrow">เข้าห้อง {code} แล้ว</p>
          <h1>พร้อมแล้ว!</h1>
          <p>รอผู้สอนเริ่มเกม หน้านี้จะเปลี่ยนอัตโนมัติ</p>
          <div className="waiting-count">ผู้เล่นในห้อง <strong>{snapshot.room.playerCount}</strong>/120</div>
        </section>
      )}

      {phase === "question" && (
        <>
          <QuestionBoard snapshot={snapshot} onAnswer={answer} answering={answering} />
          {snapshot.myAnswer && <div className="answer-sent">ส่งคำตอบแล้ว · รอเฉลยพร้อมกัน</div>}
        </>
      )}

      {phase === "reveal" && (
        <section className="player-reveal">
          <QuestionBoard snapshot={snapshot} />
          <div className={`result-card ${snapshot.myAnswer?.isCorrect ? "correct" : "wrong"}`}>
            <span>{snapshot.myAnswer?.isCorrect ? "✓" : "×"}</span>
            <div>
              <p>{snapshot.myAnswer?.isCorrect ? "ตอบถูก!" : snapshot.myAnswer ? "ยังไม่ถูก" : "ไม่ได้ตอบ"}</p>
              <strong>+{formatNumber(snapshot.myAnswer?.points ?? 0)} คะแนน</strong>
            </div>
          </div>
          <div className="phone-ranking">
            <h2>อันดับล่าสุด</h2>
            <Leaderboard rows={snapshot.leaderboard.slice(0, 5)} />
          </div>
        </section>
      )}

      {phase === "finished" && (
        <section className="phone-results">
          <p className="eyebrow">จบการแข่งขัน</p>
          <h1>{snapshot.player?.nickname}</h1>
          <div className="final-score">{formatNumber(snapshot.player?.score ?? 0)}<span>คะแนน</span></div>
          <p>ตอบถูก {snapshot.player?.correctCount ?? 0} จาก 20 ข้อ</p>
          <Leaderboard rows={snapshot.leaderboard.slice(0, 10)} />
          <button className="secondary-button" onClick={() => (window.location.href = "/")}>กลับหน้าหลัก</button>
        </section>
      )}
    </main>
  );
}

export default function Home() {
  const [screen, setScreen] = useState<Screen>({ type: "home" });

  useEffect(() => {
    const initialize = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      const host = params.get("host")?.replace(/\D/g, "").slice(0, 6);
      const join = params.get("join")?.replace(/\D/g, "").slice(0, 6);
      const token = params.get("token") ?? "";
      if (host && token) {
        localStorage.setItem(`tax-battle-host-${host}`, token);
        setScreen({ type: "host", code: host, token });
        return;
      }
      if (host) {
        const savedHost = localStorage.getItem(`tax-battle-host-${host}`);
        if (savedHost) setScreen({ type: "host", code: host, token: savedHost });
        return;
      }
      if (join) {
        const playerToken = localStorage.getItem(`tax-battle-player-${join}`);
        setScreen(playerToken ? { type: "player", code: join, token: playerToken } : { type: "join", code: join });
      }
    }, 0);
    return () => window.clearTimeout(initialize);
  }, []);

  if (screen.type === "join") {
    return <JoinScreen code={screen.code} onJoined={(token) => setScreen({ type: "player", code: screen.code, token })} />;
  }
  if (screen.type === "host") return <HostScreen code={screen.code} token={screen.token} />;
  if (screen.type === "player") return <PlayerScreen code={screen.code} token={screen.token} />;
  return <HomeScreen onJoin={(code) => {
    window.history.pushState({}, "", `/?join=${code}`);
    const playerToken = localStorage.getItem(`tax-battle-player-${code}`);
    setScreen(playerToken ? { type: "player", code, token: playerToken } : { type: "join", code });
  }} />;
}
