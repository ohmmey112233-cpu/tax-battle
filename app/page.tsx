"use client";

import QRCode from "qrcode";
import Image from "next/image";
import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { JumpGame } from "@/components/JumpGame";
import { QUESTIONS } from "@/lib/questions";

type Phase = "lobby" | "question" | "reveal" | "jump" | "finished";
type GameMode = "quiz" | "jump";

type LeaderboardRow = {
  id: string;
  nickname: string;
  score: number;
  correctCount: number;
  totalResponseMs: number;
  maxHeight: number;
  energy: number;
};

type Snapshot = {
  room: {
    code: string;
    phase: Phase;
    currentQuestion: number;
    maxPlayers: number;
    playerCount: number;
    answeredCount: number;
    questionCount: number;
    questionSeconds: number;
    gameMode: GameMode;
    gameDurationSeconds: number;
    gameStartedAt: number | null;
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
    maxHeight: number;
    energy: number;
    jumpQuestionIndex: number;
  };
  myAnswer: null | {
    answerIndex: number;
    isCorrect: boolean;
    points: number;
    responseMs: number;
  };
  jumpQuestion: null | {
    index: number;
    number: number;
    total: number;
    prompt: string;
    options: string[];
    seconds: number;
  };
  isHost: boolean;
};

type Screen =
  | { type: "home" }
  | { type: "setup" }
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

function HomeScreen({ onJoin, onCreate }: { onJoin: (code: string) => void; onCreate: () => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

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
        <StatusPill>สูงสุด 150 คน</StatusPill>
      </nav>

      <section className="hero-grid">
        <div className="hero-copy">
          <h1>Tax<br />Battle</h1>
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
            <button className="secondary-button" onClick={onCreate}>
              สร้างห้องสำหรับผู้สอน
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

const QUESTION_COUNTS = [5, 10, 15, 20] as const;
const QUESTION_TIMES = [5, 10, 15, 20] as const;
const JUMP_DURATIONS = [3, 5, 10] as const;

type CustomQuestion = {
  id: string;
  prompt: string;
  options: [string, string, string, string];
  correctIndex: number;
  explanation: string;
};

const CUSTOM_QUESTION_LIBRARY_KEY = "tax-battle-custom-question-library-v1";

function isCustomQuestion(value: unknown): value is CustomQuestion {
  if (!value || typeof value !== "object") return false;
  const question = value as Partial<CustomQuestion>;
  return (
    typeof question.id === "string" &&
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

function SetupScreen({ onBack, onCreated }: {
  onBack: () => void;
  onCreated: (code: string, token: string) => void;
}) {
  const [gameMode, setGameMode] = useState<GameMode>("quiz");
  const [jumpDurationMinutes, setJumpDurationMinutes] = useState(5);
  const [questionCount, setQuestionCount] = useState(10);
  const [selected, setSelected] = useState<number[]>(QUESTIONS.slice(0, 10).map((_, index) => index));
  const [customQuestions, setCustomQuestions] = useState<CustomQuestion[]>([]);
  const [selectedCustom, setSelectedCustom] = useState<string[]>([]);
  const [customLibraryReady, setCustomLibraryReady] = useState(false);
  const [customPrompt, setCustomPrompt] = useState("");
  const [customOptions, setCustomOptions] = useState<[string, string, string, string]>(["", "", "", ""]);
  const [customCorrectIndex, setCustomCorrectIndex] = useState(0);
  const [customExplanation, setCustomExplanation] = useState("");
  const [questionSeconds, setQuestionSeconds] = useState(15);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const importInputRef = useRef<HTMLInputElement>(null);
  const selectedCount = selected.length + selectedCustom.length;

  useEffect(() => {
    const loadLibrary = window.setTimeout(() => {
      try {
        const saved = JSON.parse(localStorage.getItem(CUSTOM_QUESTION_LIBRARY_KEY) ?? "[]") as unknown;
        if (Array.isArray(saved)) setCustomQuestions(saved.filter(isCustomQuestion).slice(0, 100));
      } catch {
        // Ignore malformed browser storage and start with an empty library.
      }
      setCustomLibraryReady(true);
    }, 0);
    return () => window.clearTimeout(loadLibrary);
  }, []);

  useEffect(() => {
    if (!customLibraryReady) return;
    try {
      localStorage.setItem(CUSTOM_QUESTION_LIBRARY_KEY, JSON.stringify(customQuestions));
    } catch {
      // The game can continue even if browser storage is unavailable.
    }
  }, [customLibraryReady, customQuestions]);

  function changeCount(nextCount: number) {
    const nextCustom = selectedCustom.slice(0, nextCount);
    const recommendedSlots = nextCount - nextCustom.length;
    setQuestionCount(nextCount);
    setSelectedCustom(nextCustom);
    setSelected((current) => {
      const next = [...current].sort((a, b) => a - b).slice(0, recommendedSlots);
      for (let index = 0; next.length < recommendedSlots && index < QUESTIONS.length; index += 1) {
        if (!next.includes(index)) next.push(index);
      }
      return next.sort((a, b) => a - b);
    });
    setError("");
    setNotice("");
  }

  function toggleQuestion(index: number) {
    setSelected((current) => {
      if (current.includes(index)) return current.filter((item) => item !== index);
      if (current.length + selectedCustom.length >= questionCount) {
        setError(`เลือกครบ ${questionCount} ข้อแล้ว กรุณาเอาข้อหนึ่งออกก่อน`);
        return current;
      }
      setError("");
      setNotice("");
      return [...current, index].sort((a, b) => a - b);
    });
  }

  function toggleCustomQuestion(id: string) {
    setSelectedCustom((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      if (current.length + selected.length >= questionCount) {
        setError(`เลือกครบ ${questionCount} ข้อแล้ว กรุณาเอาข้อหนึ่งออกก่อน`);
        return current;
      }
      setError("");
      setNotice("");
      return [...current, id];
    });
  }

  function updateCustomOption(index: number, value: string) {
    setCustomOptions((current) => current.map((option, optionIndex) => optionIndex === index ? value : option) as [string, string, string, string]);
  }

  function addCustomQuestion(event: FormEvent) {
    event.preventDefault();
    const prompt = customPrompt.trim();
    const options = customOptions.map((option) => option.trim()) as [string, string, string, string];
    if (prompt.length < 3) {
      setError("กรุณาใส่คำถามอย่างน้อย 3 ตัวอักษร");
      return;
    }
    if (options.some((option) => !option)) {
      setError("กรุณาใส่ตัวเลือกให้ครบทั้ง 4 ตัวเลือก");
      return;
    }
    const id = crypto.randomUUID();
    const shouldSelect = selectedCount < questionCount;
    setCustomQuestions((current) => [...current, {
      id,
      prompt,
      options,
      correctIndex: customCorrectIndex,
      explanation: customExplanation.trim(),
    }]);
    if (shouldSelect) setSelectedCustom((current) => [...current, id]);
    setNotice(shouldSelect
      ? "เพิ่มและเลือกคำถามของคุณแล้ว"
      : `เพิ่มคำถามแล้ว แต่ยังไม่ได้เลือก เพราะเลือกครบ ${questionCount} ข้อแล้ว`);
    setCustomPrompt("");
    setCustomOptions(["", "", "", ""]);
    setCustomCorrectIndex(0);
    setCustomExplanation("");
    setError("");
  }

  function deleteCustomQuestion(id: string) {
    setCustomQuestions((current) => current.filter((question) => question.id !== id));
    setSelectedCustom((current) => current.filter((item) => item !== id));
    setNotice("ลบคำถามเพิ่มเองแล้ว คุณสามารถเลือกคำถามแนะนำกลับเข้ามาได้");
    setError("");
  }

  function exportCustomQuestions() {
    if (!customQuestions.length) {
      setError("ยังไม่มีคำถามเพิ่มเองให้ส่งออก");
      return;
    }
    const file = new Blob([JSON.stringify({
      format: "tax-battle-question-library",
      version: 1,
      exportedAt: new Date().toISOString(),
      questions: customQuestions,
    }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = `tax-battle-questions-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setNotice(`ส่งออกคำถาม ${customQuestions.length} ข้อแล้ว`);
    setError("");
  }

  async function importCustomQuestions(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      if (file.size > 1_000_000) throw new Error("ไฟล์ใหญ่เกิน 1 MB");
      const parsed = JSON.parse(await file.text()) as unknown;
      const source = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === "object" && Array.isArray((parsed as { questions?: unknown[] }).questions)
          ? (parsed as { questions: unknown[] }).questions
          : null;
      if (!source) throw new Error("รูปแบบไฟล์ไม่ถูกต้อง");
      const imported = source.filter(isCustomQuestion).map((item) => ({ ...item, id: crypto.randomUUID() }));
      if (!imported.length) throw new Error("ไม่พบคำถามที่ใช้งานได้ในไฟล์");
      const keys = new Set(customQuestions.map((item) => `${item.prompt}\u0000${item.options.join("\u0000")}`.toLocaleLowerCase("th-TH")));
      const next = [...customQuestions];
      let added = 0;
      for (const item of imported) {
        const key = `${item.prompt}\u0000${item.options.join("\u0000")}`.toLocaleLowerCase("th-TH");
        if (keys.has(key) || next.length >= 100) continue;
        keys.add(key);
        next.push(item);
        added += 1;
      }
      if (!added) throw new Error("คำถามในไฟล์มีอยู่ในคลังแล้วทั้งหมด หรือคลังเต็ม 100 ข้อ");
      setCustomQuestions(next);
      setNotice(`นำเข้าคำถามใหม่ ${added} ข้อแล้ว`);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "นำเข้าคำถามไม่สำเร็จ");
    }
  }

  async function createRoom() {
    if (selectedCount !== questionCount) {
      setError(`กรุณาเลือกคำถามให้ครบ ${questionCount} ข้อ`);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const room = await readJson<{ code: string; hostToken: string }>(
        await fetch("/api/rooms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            gameMode,
            gameDurationSeconds: jumpDurationMinutes * 60,
            questionSeconds,
            selectedQuestions: selected,
            customQuestions: customQuestions.filter((question) => selectedCustom.includes(question.id)).map(({ prompt, options, correctIndex, explanation }) => ({
              prompt,
              options,
              correctIndex,
              explanation,
            })),
          }),
        })
      );
      localStorage.setItem(`tax-battle-host-${room.code}`, room.hostToken);
      window.history.pushState({}, "", `/?host=${room.code}&token=${room.hostToken}`);
      onCreated(room.code, room.hostToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : "สร้างห้องไม่สำเร็จ");
      setBusy(false);
    }
  }

  return (
    <main className="setup-shell">
      <nav className="setup-topbar">
        <Brand />
        <button className="text-button setup-back" onClick={onBack}>← กลับหน้าหลัก</button>
      </nav>

      <div className="setup-main">
        <header className="setup-heading">
          <p className="eyebrow">HOST CONTROL</p>
          <div className="setup-heading-line">
            <h1>ตั้งค่าสนามแข่งขัน</h1>
            <div className="current-question-count"><span>เลือกแล้ว</span><strong>{selectedCount}/{questionCount}</strong></div>
          </div>
          <p>เลือกชุดคำถามและเวลาให้พร้อมก่อนเปิดห้อง การตั้งค่าจะถูกล็อกทันทีเมื่อสร้างห้อง</p>
          <div className="mode-selector" aria-label="เลือกโหมดเกม">
            <button className={gameMode === "quiz" ? "active" : ""} onClick={() => setGameMode("quiz")}>
              <span className="mode-icon">◆</span>
              <span><strong>Quiz Battle</strong><small>ตอบพร้อมกันแบบคลาสสิก</small></span>
              <i>{gameMode === "quiz" ? "✓" : ""}</i>
            </button>
            <button className={gameMode === "jump" ? "active jump" : "jump"} onClick={() => setGameMode("jump")}>
              <span className="mode-icon">↗</span>
              <span><strong>Jump Battle</strong><small>กระโดดให้สูง ตอบ Quiz เติมพลัง</small></span>
              <i>{gameMode === "jump" ? "✓" : ""}</i>
            </button>
          </div>
        </header>

        <section className="setup-step">
          <div className="step-title"><span className="step-number">1</span><div><h2>จำนวนคำถาม</h2><p>เลือกจำนวนข้อที่ต้องการใช้ในเกม</p></div></div>
          <div className="segmented" aria-label="จำนวนคำถาม">
            {QUESTION_COUNTS.map((count) => (
              <button key={count} className={questionCount === count ? "active" : ""} onClick={() => changeCount(count)}>{count} ข้อ</button>
            ))}
          </div>
        </section>

        <section className="setup-step question-step">
          <div className="step-title"><span className="step-number">2</span><div><h2>คำถาม</h2><p>เพิ่มคำถามเองหรือเลือกจากคำถามแนะนำให้ครบจำนวนที่กำหนด</p></div></div>
          <div className={`selection-summary ${selectedCount === questionCount ? "complete" : ""}`}>
            เลือกแล้ว <strong>{selectedCount}/{questionCount}</strong> ข้อ
          </div>

          <div className="question-section-block">
            <div className="question-subheading question-library-heading">
              <div><span>เพิ่มเอง</span><h3>คำถามเพิ่มเอง</h3></div>
              <div className="library-heading-actions">
                <small>{customQuestions.length} ข้อในคลัง · เลือก {selectedCustom.length}</small>
                <button type="button" onClick={() => importInputRef.current?.click()}>นำเข้า JSON</button>
                <button type="button" onClick={exportCustomQuestions} disabled={!customQuestions.length}>ส่งออก</button>
                <input ref={importInputRef} className="hidden-file-input" type="file" accept="application/json,.json" onChange={importCustomQuestions} />
              </div>
            </div>
            <p className="question-library-note">บันทึกไว้ในเครื่องนี้อัตโนมัติ เพื่อเลือกใช้ซ้ำในห้องรอบถัดไป</p>
            <form className="custom-question-form" onSubmit={addCustomQuestion}>
              <label className="custom-field custom-prompt-field">
                <span>คำถาม</span>
                <textarea maxLength={300} placeholder="พิมพ์คำถามที่ต้องการใช้ในเกม" value={customPrompt} onChange={(event) => setCustomPrompt(event.target.value)} />
              </label>
              <div className="custom-options-grid">
                {customOptions.map((option, index) => (
                  <label className="custom-field" key={index}>
                    <span>ตัวเลือก {String.fromCharCode(65 + index)}</span>
                    <input maxLength={160} placeholder={`คำตอบ ${String.fromCharCode(65 + index)}`} value={option} onChange={(event) => updateCustomOption(index, event.target.value)} />
                  </label>
                ))}
              </div>
              <div className="custom-form-bottom">
                <div>
                  <label>คำตอบที่ถูกต้อง</label>
                  <div className="correct-answer-picker">
                    {customOptions.map((_, index) => (
                      <button type="button" className={customCorrectIndex === index ? "active" : ""} onClick={() => setCustomCorrectIndex(index)} key={index}>{String.fromCharCode(65 + index)}</button>
                    ))}
                  </div>
                </div>
                <label className="custom-field explanation-field">
                  <span>คำอธิบายเพิ่มเติม (ไม่บังคับ)</span>
                  <textarea maxLength={500} placeholder="อธิบายเฉลยสั้นๆ" value={customExplanation} onChange={(event) => setCustomExplanation(event.target.value)} />
                </label>
              </div>
              <button className="add-question-button" type="submit">+ เพิ่มคำถามนี้</button>
            </form>

            {customQuestions.length > 0 && (
              <div className="custom-question-list">
                {customQuestions.map((question, index) => {
                  const isSelected = selectedCustom.includes(question.id);
                  return (
                    <article className={`custom-question-item ${isSelected ? "selected" : ""}`} key={question.id}>
                      <button className="custom-question-toggle" onClick={() => toggleCustomQuestion(question.id)} aria-pressed={isSelected}>
                        <span className="question-check">{isSelected ? "✓" : ""}</span>
                        <span className="question-index">C{String(index + 1).padStart(2, "0")}</span>
                        <span><strong>{question.prompt}</strong><small>คำตอบ: {String.fromCharCode(65 + question.correctIndex)} · {question.options[question.correctIndex]}</small></span>
                      </button>
                      <button className="delete-custom-question" onClick={() => deleteCustomQuestion(question.id)} aria-label={`ลบคำถาม ${question.prompt}`}>ลบ</button>
                    </article>
                  );
                })}
              </div>
            )}
          </div>

          <div className="question-section-block recommended-question-block">
            <div className="question-subheading"><div><span>พร้อมใช้</span><h3>คำถามแนะนำ</h3></div><small>{selected.length} ข้อที่เลือก</small></div>
            <div className="question-picker">
              {QUESTIONS.map((question, index) => {
                const isSelected = selected.includes(index);
                const isExpanded = expanded === index;
                return (
                  <article className={`question-card ${isSelected ? "selected" : ""}`} key={question.prompt}>
                    <div className="question-card-head">
                      <button className="question-toggle" onClick={() => toggleQuestion(index)} aria-pressed={isSelected}>
                        <span className="question-check">{isSelected ? "✓" : ""}</span>
                        <span className="question-index">{String(index + 1).padStart(2, "0")}</span>
                        <span className="question-copy">{question.prompt}</span>
                      </button>
                      <button className="detail-button" onClick={() => setExpanded(isExpanded ? null : index)} aria-expanded={isExpanded}>
                        {isExpanded ? "ซ่อน" : "ดูรายละเอียด"}
                      </button>
                    </div>
                    {isExpanded && (
                      <div className="question-details">
                        <div className="option-preview-grid">
                          {question.options.map((option, optionIndex) => (
                            <span className={optionIndex === question.correctIndex ? "correct" : ""} key={option}>
                              {ANSWER_ICONS[optionIndex]} {option}{optionIndex === question.correctIndex ? " ✓" : ""}
                            </span>
                          ))}
                        </div>
                        <p><strong>คำอธิบาย:</strong> {question.explanation}</p>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section className="setup-step">
          <div className="step-title"><span className="step-number">3</span><div><h2>เวลาต่อข้อ</h2><p>ใช้เวลาเดียวกันสำหรับทุกคำถาม</p></div></div>
          <div className="segmented" aria-label="เวลาต่อข้อ">
            {QUESTION_TIMES.map((seconds) => (
              <button key={seconds} className={questionSeconds === seconds ? "active" : ""} onClick={() => setQuestionSeconds(seconds)}>{seconds} วิ</button>
            ))}
          </div>
        </section>

        {gameMode === "jump" && (
          <section className="setup-step jump-duration-step">
            <div className="step-title"><span className="step-number">4</span><div><h2>เวลาแข่งขัน Jump Battle</h2><p>ทุกคนเริ่มและจบพร้อมกัน ผู้คุมเห็นอันดับความสูงแบบสด</p></div></div>
            <div className="segmented" aria-label="เวลาแข่งขันเกมกระโดด">
              {JUMP_DURATIONS.map((minutes) => (
                <button key={minutes} className={jumpDurationMinutes === minutes ? "active" : ""} onClick={() => setJumpDurationMinutes(minutes)}>{minutes} นาที</button>
              ))}
            </div>
          </section>
        )}

        {error && <ErrorBanner message={error} />}
        {notice && <div className="notice-banner">✓ {notice}</div>}
      </div>

      <div className="setup-actionbar">
        <div><span>{selectedCount === questionCount ? `พร้อมสร้างห้อง ${gameMode === "jump" ? "Jump Battle" : "Quiz Battle"}` : `เลือกคำถามอีก ${questionCount - selectedCount} ข้อ`}</span><strong>{selectedCount}/{questionCount} ข้อ · {questionSeconds} วินาที/ข้อ{gameMode === "jump" ? ` · ${jumpDurationMinutes} นาที` : ""}</strong></div>
        <button className="start-button" onClick={createRoom} disabled={busy || selectedCount !== questionCount}>
          {busy ? "กำลังสร้างห้อง…" : "สร้างห้องและรับ QR Code"} <span>→</span>
        </button>
      </div>
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

function Leaderboard({ rows, full = false, mode = "quiz" }: { rows: LeaderboardRow[]; full?: boolean; mode?: GameMode }) {
  if (!rows.length) return <div className="empty-state">ยังไม่มีคะแนน</div>;
  return (
    <div className={`leaderboard ${full ? "leaderboard-full" : ""}`}>
      {rows.map((row, index) => (
        <div className={`leader-row rank-${index + 1}`} key={row.id}>
          <span className="rank-number">{index + 1}</span>
          <span className="leader-name">{row.nickname}</span>
          <span className="leader-correct">{mode === "jump" ? `Quiz ถูก ${row.correctCount} · ${formatNumber(row.score)} pt` : `ถูก ${row.correctCount}`}</span>
          <strong>{mode === "jump" ? `${formatNumber(row.maxHeight)} ม.` : formatNumber(row.score)}</strong>
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

function PodiumPlace({ rank, row, revealed, mode }: {
  rank: 1 | 2 | 3;
  row?: LeaderboardRow;
  revealed: boolean;
  mode: GameMode;
}) {
  const medals = { 1: "★", 2: "◆", 3: "●" };
  return (
    <article className={`podium-place podium-rank-${rank} ${revealed ? "is-revealed" : ""}`}>
      <div className="podium-player">
        <span className="podium-medal">{revealed ? medals[rank] : "?"}</span>
        <p>{revealed ? row?.nickname ?? "ยังไม่มีผู้เล่น" : `กำลังเปิดเผยอันดับ ${rank}`}</p>
        <strong>{revealed && row ? mode === "jump" ? `${formatNumber(row.maxHeight)} เมตร` : `${formatNumber(row.score)} คะแนน` : "••••••"}</strong>
      </div>
      <div className="podium-block"><span>{rank}</span></div>
    </article>
  );
}

function FinalPodium({ rows, onComplete, mode }: {
  rows: LeaderboardRow[];
  onComplete: () => void;
  mode: GameMode;
}) {
  const [stage, setStage] = useState(0);

  useEffect(() => {
    const timers = [
      window.setTimeout(() => setStage(1), 1400),
      window.setTimeout(() => setStage(2), 3600),
      window.setTimeout(() => setStage(3), 5800),
      window.setTimeout(onComplete, 11000),
    ];
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [onComplete]);

  const announcement = stage === 0
    ? "กำลังคำนวณคะแนนสุดท้าย…"
    : stage === 1
      ? "อันดับ 3 ได้แก่…"
      : stage === 2
        ? "ต่อไป อันดับ 2…"
        : "แชมป์ Tax Battle คือ!";

  return (
    <section className={`podium-reveal podium-stage-${stage}`} aria-live="polite">
      <div className="podium-spotlight spotlight-left" />
      <div className="podium-spotlight spotlight-right" />
      <div className="podium-confetti" aria-hidden="true">
        {Array.from({ length: 18 }, (_, index) => <span key={index} style={{ "--confetti-index": index } as React.CSSProperties} />)}
      </div>
      <header className="podium-heading">
        <p className="eyebrow">FINAL PODIUM</p>
        <h1 key={stage}>{announcement}</h1>
        <p>{mode === "jump" ? "วัดจากความสูงสูงสุด และใช้คะแนน Quiz ตัดสินเมื่อเสมอ" : "วัดจากคะแนน ความถูกต้อง และความเร็ว"}</p>
      </header>
      <div className="podium-grid">
        <PodiumPlace rank={2} row={rows[1]} revealed={stage >= 2} mode={mode} />
        <PodiumPlace rank={1} row={rows[0]} revealed={stage >= 3} mode={mode} />
        <PodiumPlace rank={3} row={rows[2]} revealed={stage >= 1} mode={mode} />
      </div>
      <div className="podium-footer">
        <div className="podium-progress" aria-label={`ขั้นประกาศผล ${stage} จาก 3`}>
          {[1, 2, 3].map((step) => <span className={stage >= step ? "active" : ""} key={step} />)}
        </div>
        <button className="podium-skip" onClick={onComplete}>ดูคะแนนรวมทันที →</button>
      </div>
    </section>
  );
}

function HostJumpDashboard({ snapshot, onFinish, busy }: {
  snapshot: Snapshot;
  onFinish: () => void;
  busy: boolean;
}) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);
  const effectiveNow = now || snapshot.room.gameStartedAt || 0;
  const endAt = (snapshot.room.gameStartedAt ?? effectiveNow) + snapshot.room.gameDurationSeconds * 1000;
  const remaining = Math.max(0, Math.ceil((endAt - effectiveNow) / 1000));
  const minutes = String(Math.floor(remaining / 60)).padStart(2, "0");
  const seconds = String(remaining % 60).padStart(2, "0");
  const peak = snapshot.leaderboard[0]?.maxHeight ?? 0;
  const average = snapshot.leaderboard.length
    ? Math.round(snapshot.leaderboard.reduce((sum, row) => sum + row.maxHeight, 0) / snapshot.leaderboard.length)
    : 0;
  const correct = snapshot.leaderboard.reduce((sum, row) => sum + row.correctCount, 0);
  const progress = Math.max(0, Math.min(100, (remaining / snapshot.room.gameDurationSeconds) * 100));

  return (
    <section className="host-jump-dashboard">
      <header className="host-jump-heading">
        <div><p className="eyebrow">JUMP BATTLE · LIVE</p><h1>ใครจะขึ้นไปได้สูงที่สุด?</h1><p>ความสูงเป็นอันดับหลัก · คะแนน Quiz ใช้ตัดสินเมื่อเสมอ</p></div>
        <div className="host-jump-clock"><span>เหลือเวลา</span><strong>{minutes}:{seconds}</strong><div><i style={{ width: `${progress}%` }} /></div></div>
      </header>
      <div className="host-jump-stats">
        <article><span>ผู้เล่นในสนาม</span><strong>{snapshot.room.playerCount}</strong><small>คน</small></article>
        <article><span>จุดสูงสุด</span><strong>{formatNumber(peak)}</strong><small>เมตร</small></article>
        <article><span>ความสูงเฉลี่ย</span><strong>{formatNumber(average)}</strong><small>เมตร</small></article>
        <article><span>ตอบถูกสะสม</span><strong>{formatNumber(correct)}</strong><small>ข้อ</small></article>
      </div>
      <div className="host-jump-ranking">
        <div className="host-jump-ranking-head"><div><span>LIVE RANKING</span><h2>อันดับความสูงล่าสุด</h2></div><span className="connection-dot">อัปเดตอัตโนมัติ</span></div>
        <Leaderboard rows={snapshot.leaderboard} mode="jump" full />
      </div>
      <button className="finish-jump-button" onClick={onFinish} disabled={busy}>จบการแข่งขันก่อนเวลา</button>
    </section>
  );
}

function HostScreen({ code, token }: { code: string; token: string }) {
  const { snapshot, error, refresh } = useSnapshot(code, "host", token);
  const [qr, setQr] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPodium, setShowPodium] = useState(false);
  const previousPhase = useRef<Phase | null>(null);
  const joinUrl = useMemo(() => (typeof window === "undefined" ? "" : `${window.location.origin}/?join=${code}`), [code]);
  const finishPodium = useCallback(() => setShowPodium(false), []);

  useEffect(() => {
    if (!joinUrl) return;
    QRCode.toDataURL(joinUrl, {
      width: 420,
      margin: 2,
      errorCorrectionLevel: "H",
      color: { dark: "#071019", light: "#ffffff" },
    }).then(setQr);
  }, [joinUrl]);

  useEffect(() => {
    if (!snapshot) return;
    if (previousPhase.current === "jump" && snapshot.room.phase === "finished") setShowPodium(true);
    previousPhase.current = snapshot.room.phase;
  }, [snapshot]);

  async function control(action: string) {
    setBusy(true);
    try {
      await readJson(await fetch(`/api/rooms/${code}/control`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hostToken: token, action }),
      }));
      if (action === "next" && snapshot?.question?.number === snapshot?.question?.total) {
        setShowPodium(true);
      }
      if (action === "reset") setShowPodium(false);
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
              <div><p>ผู้เล่นพร้อมแล้ว</p><strong>{snapshot.room.playerCount}<small>/{snapshot.room.maxPlayers}</small></strong></div>
              <div className="lobby-status-stack">
                <StatusPill tone="lime">กำลังรอ</StatusPill>
                <StatusPill>{snapshot.room.gameMode === "jump" ? `Jump Battle · ${snapshot.room.gameDurationSeconds / 60} นาที` : "Quiz Battle"}</StatusPill>
                <StatusPill>{snapshot.room.questionCount} ข้อ · {snapshot.room.questionSeconds} วินาที/ข้อ</StatusPill>
              </div>
            </div>
            <div className="roster-list">
              {snapshot.leaderboard.length ? snapshot.leaderboard.map((player) => (
                <span key={player.id}>{player.nickname}</span>
              )) : <div className="empty-roster"><span>↗</span>รายชื่อจะปรากฏที่นี่</div>}
            </div>
            <button className="start-button" onClick={() => control("start")} disabled={busy}>
              {snapshot.room.gameMode === "jump" ? `เริ่ม Jump Battle ${snapshot.room.gameDurationSeconds / 60} นาที` : `เริ่มเกม ${snapshot.room.questionCount} ข้อ`} <span>→</span>
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

      {phase === "jump" && (
        <HostJumpDashboard snapshot={snapshot} onFinish={() => control("finish")} busy={busy} />
      )}

      {phase === "finished" && showPodium && (
        <FinalPodium rows={snapshot.leaderboard.slice(0, 3)} onComplete={finishPodium} mode={snapshot.room.gameMode} />
      )}

      {phase === "finished" && !showPodium && (
        <section className="results-layout">
          <div className="results-title">
            <p className="eyebrow">FINAL SCORE</p>
            <h1>{snapshot.room.gameMode === "jump" ? "ยอดนักกระโดดแห่ง Tax Battle" : "สุดยอดนักวางแผนภาษี"}</h1>
            <p>{snapshot.room.gameMode === "jump" ? "เรียงตามความสูงสูงสุด และใช้คะแนน Quiz ตัดสินเมื่อเสมอ" : `คะแนนรวมจากความถูกต้องและความเร็วทั้ง ${snapshot.room.questionCount} ข้อ`}</p>
            <button className="secondary-button" onClick={() => control("reset")} disabled={busy}>เล่นอีกรอบ</button>
          </div>
          <Leaderboard rows={snapshot.leaderboard} full mode={snapshot.room.gameMode} />
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
          <strong>{snapshot.room.gameMode === "jump" ? `${formatNumber(snapshot.player?.maxHeight ?? 0)} ม. · Quiz ${formatNumber(snapshot.player?.score ?? 0)}` : `${formatNumber(snapshot.player?.score ?? 0)} คะแนน`}</strong>
        </div>
      </nav>

      {(error || answerError) && <ErrorBanner message={error || answerError} />}

      {phase === "lobby" && (
        <section className="waiting-card">
          <div className="waiting-pulse"><span>✓</span></div>
          <p className="eyebrow">เข้าห้อง {code} แล้ว</p>
          <h1>พร้อมแล้ว!</h1>
          <p>รอผู้สอนเริ่ม {snapshot.room.gameMode === "jump" ? "Jump Battle" : "เกม Quiz"} หน้านี้จะเปลี่ยนอัตโนมัติ</p>
          <div className="waiting-count">ผู้เล่นในห้อง <strong>{snapshot.room.playerCount}</strong>/{snapshot.room.maxPlayers}</div>
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

      {phase === "jump" && snapshot.room.gameStartedAt && snapshot.jumpQuestion && snapshot.player && (
        <JumpGame
          code={code}
          token={token}
          gameStartedAt={snapshot.room.gameStartedAt}
          durationSeconds={snapshot.room.gameDurationSeconds}
          initialEnergy={snapshot.player.energy}
          initialHeight={snapshot.player.maxHeight}
          initialScore={snapshot.player.score}
          question={snapshot.jumpQuestion}
          onRefresh={refresh}
        />
      )}

      {phase === "finished" && (
        <section className="phone-results">
          <p className="eyebrow">จบการแข่งขัน</p>
          <h1>{snapshot.player?.nickname}</h1>
          <div className="final-score">{formatNumber(snapshot.room.gameMode === "jump" ? snapshot.player?.maxHeight ?? 0 : snapshot.player?.score ?? 0)}<span>{snapshot.room.gameMode === "jump" ? "เมตรสูงสุด" : "คะแนน"}</span></div>
          <p>{snapshot.room.gameMode === "jump" ? `Quiz ${formatNumber(snapshot.player?.score ?? 0)} คะแนน · ตอบถูก ${snapshot.player?.correctCount ?? 0} ข้อ` : `ตอบถูก ${snapshot.player?.correctCount ?? 0} จาก ${snapshot.room.questionCount} ข้อ`}</p>
          <Leaderboard rows={snapshot.leaderboard.slice(0, 10)} mode={snapshot.room.gameMode} />
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
  if (screen.type === "setup") {
    return <SetupScreen onBack={() => setScreen({ type: "home" })} onCreated={(code, token) => setScreen({ type: "host", code, token })} />;
  }
  if (screen.type === "host") return <HostScreen code={screen.code} token={screen.token} />;
  if (screen.type === "player") return <PlayerScreen code={screen.code} token={screen.token} />;
  return <HomeScreen
    onCreate={() => setScreen({ type: "setup" })}
    onJoin={(code) => {
      window.history.pushState({}, "", `/?join=${code}`);
      const playerToken = localStorage.getItem(`tax-battle-player-${code}`);
      setScreen(playerToken ? { type: "player", code, token: playerToken } : { type: "join", code });
    }}
  />;
}
