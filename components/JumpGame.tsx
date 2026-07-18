"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type JumpQuestion = {
  index: number;
  number: number;
  total: number;
  prompt: string;
  options: string[];
  seconds: number;
};

type JumpAnswerResult = {
  isCorrect: boolean;
  correctIndex: number;
  explanation: string;
  points: number;
  energyGain: number;
  energy: number;
  score: number;
  correctCount: number;
  nextQuestion: JumpQuestion;
};

type Platform = {
  x: number;
  y: number;
  width: number;
  type: "grass" | "bridge" | "cloud" | "crate" | "stone" | "metal";
  decor: "flag" | "plant" | "lamp" | "coin" | null;
  summit: number | null;
};

type PlayerPhysics = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  jumps: number;
  checkpointIndex: number;
  cameraBottom: number;
};

type JumpGameProps = {
  code: string;
  token: string;
  gameStartedAt: number;
  durationSeconds: number;
  initialEnergy: number;
  initialHeight: number;
  initialScore: number;
  question: JumpQuestion;
  onRefresh: () => Promise<void>;
};

const WORLD_WIDTH = 360;
const PLAYER_WIDTH = 30;
const PLAYER_HEIGHT = 38;
const ENERGY_THRESHOLD = 15;
const ANSWER_STYLES = ["answer-red", "answer-blue", "answer-amber", "answer-green"];
const ANSWER_ICONS = ["▲", "◆", "●", "■"];

function hashSeed(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function randomGenerator(seed: number) {
  let value = seed || 1;
  return () => {
    value += 0x6d2b79f5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function makePlatforms(seedText: string) {
  const random = randomGenerator(hashSeed(seedText));
  const platforms: Platform[] = [
    { x: 42, y: 0, width: 276, type: "grass", decor: "flag", summit: 0 },
  ];
  let previousCenter = WORLD_WIDTH / 2;
  let y = 0;

  for (let index = 1; index < 170; index += 1) {
    const difficulty = Math.min(1, index / 115);
    const summit = index % 28 === 0 ? index / 28 : null;
    const isBridge = !summit && index % 9 === 0;
    const isCloud = !summit && index % 13 === 0;
    const isCrate = !summit && index % 7 === 0 && !isBridge && !isCloud;
    const isMetal = !summit && index > 80 && index % 5 === 0;
    const isStone = !summit && index > 35 && index % 4 === 0;
    // Every route is reachable with one jump. Higher zones get narrower,
    // less forgiving platforms rather than impossible vertical gaps.
    const verticalGap = summit ? 68 : 58 + random() * (24 + difficulty * 10);
    const width = summit
      ? 238
      : isBridge
      ? 142 + random() * 28
      : isCloud
        ? 92 + random() * 34
        : isCrate
          ? 70 + random() * 24
          : Math.max(72, 126 - difficulty * 42 + random() * 30);
    const shift = summit ? WORLD_WIDTH / 2 - previousCenter : (random() - 0.5) * (150 + difficulty * 44);
    const center = Math.max(width / 2 + 12, Math.min(WORLD_WIDTH - width / 2 - 12, previousCenter + shift));
    y += verticalGap;
    const decorRoll = index % 11;
    platforms.push({
      x: center - width / 2,
      y,
      width,
      type: isBridge ? "bridge" : isCloud ? "cloud" : isCrate ? "crate" : isMetal ? "metal" : isStone ? "stone" : "grass",
      decor: summit !== null ? "flag" : decorRoll === 2 ? "plant" : decorRoll === 5 ? "lamp" : decorRoll === 8 ? "coin" : null,
      summit,
    });
    previousCenter = center;
  }
  return platforms;
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  fill: string,
) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
  context.fillStyle = fill;
  context.fill();
}

function formatTime(seconds: number) {
  const safe = Math.max(0, Math.ceil(seconds));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

export function JumpGame({
  code,
  token,
  gameStartedAt,
  durationSeconds,
  initialEnergy,
  initialHeight,
  initialScore,
  question,
  onRefresh,
}: JumpGameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const physicsRef = useRef<PlayerPhysics>({
    x: WORLD_WIDTH / 2,
    y: 1,
    vx: 0,
    vy: 0,
    jumps: 0,
    checkpointIndex: 0,
    cameraBottom: 0,
  });
  const inputRef = useRef({ left: false, right: false });
  const energyRef = useRef(Math.max(0, Math.min(100, initialEnergy)));
  const maxHeightRef = useRef(Math.max(0, initialHeight));
  const quizOpenRef = useRef(false);
  const lastFrameRef = useRef(0);
  const lastHudRef = useRef(0);
  const lastSyncRef = useRef(0);
  const finalSyncSentRef = useRef(false);
  const questionIndexRef = useRef(question.index);
  const platforms = useMemo(() => makePlatforms(code), [code]);
  const [energy, setEnergy] = useState(energyRef.current);
  const [maxHeight, setMaxHeight] = useState(maxHeightRef.current);
  const [score, setScore] = useState(initialScore);
  const [now, setNow] = useState(0);
  const [quizOpen, setQuizOpen] = useState(false);
  const [activeQuestion, setActiveQuestion] = useState(question);
  const [quizStartedAt, setQuizStartedAt] = useState(0);
  const [answerResult, setAnswerResult] = useState<JumpAnswerResult | null>(null);
  const [answering, setAnswering] = useState(false);
  const [quizError, setQuizError] = useState("");
  const [toast, setToast] = useState("วิ่งแล้วกดกระโดดเพื่อข้ามช่องว่างให้ไกลขึ้น");
  const endAt = gameStartedAt + durationSeconds * 1000;
  const effectiveNow = now || gameStartedAt;
  const secondsLeft = Math.max(0, (endAt - effectiveNow) / 1000);

  const openQuiz = useCallback((forced = false) => {
    quizOpenRef.current = true;
    setAnswerResult(null);
    setQuizError("");
    setQuizStartedAt(Date.now());
    setQuizOpen(true);
    if (forced) setToast("พลังงานต่ำ! ตอบคำถามเพื่อเติมพลัง");
  }, []);

  const closeQuiz = useCallback(() => {
    if (energyRef.current <= ENERGY_THRESHOLD) return;
    if (answerResult) setActiveQuestion(answerResult.nextQuestion);
    quizOpenRef.current = false;
    setQuizOpen(false);
    setAnswerResult(null);
    setToast("เติมพลังแล้ว ไปต่อเลย!");
  }, [answerResult]);

  const nextQuiz = useCallback(() => {
    if (!answerResult) return;
    setActiveQuestion(answerResult.nextQuestion);
    setAnswerResult(null);
    setQuizError("");
    setQuizStartedAt(Date.now());
  }, [answerResult]);

  const submitAnswer = useCallback(async (answerIndex: number) => {
    if (answering || answerResult) return;
    setAnswering(true);
    setQuizError("");
    try {
      const response = await fetch(`/api/rooms/${code}/jump/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerToken: token,
          questionIndex: activeQuestion.index,
          answerIndex,
          responseMs: Math.max(0, Date.now() - quizStartedAt),
        }),
      });
      const body = await response.json() as JumpAnswerResult & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "ส่งคำตอบไม่สำเร็จ");
      energyRef.current = body.energy;
      questionIndexRef.current = body.nextQuestion.index;
      setEnergy(body.energy);
      setScore(body.score);
      setAnswerResult(body);
      void onRefresh();
    } catch (error) {
      setQuizError(error instanceof Error ? error.message : "ส่งคำตอบไม่สำเร็จ");
    } finally {
      setAnswering(false);
    }
  }, [activeQuestion.index, answerResult, answering, code, onRefresh, quizStartedAt, token]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    function keyDown(event: KeyboardEvent) {
      if (event.code === "ArrowLeft" || event.code === "KeyA") inputRef.current.left = true;
      if (event.code === "ArrowRight" || event.code === "KeyD") inputRef.current.right = true;
      if (event.code === "Space" || event.code === "ArrowUp" || event.code === "KeyW") {
        event.preventDefault();
        jump();
      }
    }
    function keyUp(event: KeyboardEvent) {
      if (event.code === "ArrowLeft" || event.code === "KeyA") inputRef.current.left = false;
      if (event.code === "ArrowRight" || event.code === "KeyD") inputRef.current.right = false;
    }
    function clearInput() {
      inputRef.current.left = false;
      inputRef.current.right = false;
    }
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    window.addEventListener("pointerup", clearInput);
    window.addEventListener("pointercancel", clearInput);
    return () => {
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      window.removeEventListener("pointerup", clearInput);
      window.removeEventListener("pointercancel", clearInput);
    };
  });

  function jump() {
    if (quizOpenRef.current || secondsLeft <= 0 || energyRef.current <= ENERGY_THRESHOLD) {
      if (energyRef.current <= ENERGY_THRESHOLD && !quizOpenRef.current) openQuiz(true);
      return;
    }
    const player = physicsRef.current;
    if (player.jumps >= 1) return;
    player.vy = 500;
    player.jumps = 1;
    energyRef.current = Math.max(0, energyRef.current - 4);
    setEnergy(Math.round(energyRef.current));
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let animation = 0;

    function draw(context: CanvasRenderingContext2D, width: number, height: number) {
      const player = physicsRef.current;
      const scale = width / WORLD_WIDTH;
      const worldHeight = height / scale;
      const toScreenY = (worldY: number) => worldHeight - 116 - (worldY - player.cameraBottom);

      const zone = Math.min(5, Math.floor(player.cameraBottom / 1_750));
      const skyPalettes = [
        ["#081d42", "#0c79a5", "#6de3d0"],
        ["#2b174f", "#a34f79", "#ffb16f"],
        ["#15163c", "#4b3e87", "#9d83d9"],
        ["#07152f", "#163d69", "#3b7e9a"],
        ["#04091b", "#111c45", "#293a70"],
        ["#02040d", "#090e28", "#17244b"],
      ];
      const palette = skyPalettes[zone];
      const sky = context.createLinearGradient(0, 0, 0, height);
      sky.addColorStop(0, palette[0]);
      sky.addColorStop(0.56, palette[1]);
      sky.addColorStop(1, palette[2]);
      context.fillStyle = sky;
      context.fillRect(0, 0, width, height);
      context.save();
      context.scale(scale, scale);

      if (zone >= 2) {
        context.fillStyle = "rgba(255,255,255,.72)";
        for (let index = 0; index < 22; index += 1) {
          const starX = (index * 83 + 19) % WORLD_WIDTH;
          const starY = (index * 47 + player.cameraBottom * 0.08) % Math.max(220, worldHeight - 120);
          const size = index % 4 === 0 ? 1.7 : 1;
          context.beginPath();
          context.arc(starX, starY, size, 0, Math.PI * 2);
          context.fill();
        }
      }

      const mountainBase = worldHeight - 44;
      context.globalAlpha = zone < 3 ? 0.2 : 0.12;
      context.fillStyle = zone < 2 ? "#123f55" : "#080d28";
      context.beginPath();
      context.moveTo(0, mountainBase);
      for (let x = 0; x <= WORLD_WIDTH; x += 45) {
        const peak = mountainBase - 45 - ((x * 7 + Math.floor(player.cameraBottom * 0.04)) % 74);
        context.lineTo(x + 22, peak);
        context.lineTo(x + 45, mountainBase);
      }
      context.lineTo(WORLD_WIDTH, worldHeight);
      context.lineTo(0, worldHeight);
      context.fill();
      context.globalAlpha = 1;

      for (let index = 0; index < 9; index += 1) {
        const cloudY = ((index * 153 - player.cameraBottom * 0.18) % (worldHeight + 180)) - 60;
        const cloudX = 22 + ((index * 97) % 300);
        context.globalAlpha = 0.12;
        context.fillStyle = "#ffffff";
        context.beginPath();
        context.arc(cloudX, cloudY, 24, 0, Math.PI * 2);
        context.arc(cloudX + 25, cloudY - 8, 18, 0, Math.PI * 2);
        context.arc(cloudX + 48, cloudY, 22, 0, Math.PI * 2);
        context.fill();
      }
      context.globalAlpha = 1;

      if (zone === 0 || zone === 1) {
        const balloonX = 38 + (player.cameraBottom * 0.025) % 270;
        const balloonY = 205 - (player.cameraBottom * 0.05) % 170;
        context.fillStyle = zone === 0 ? "#ff7b91" : "#ffd05b";
        context.beginPath();
        context.ellipse(balloonX, balloonY, 12, 16, 0, 0, Math.PI * 2);
        context.fill();
        context.strokeStyle = "rgba(255,255,255,.55)";
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(balloonX - 5, balloonY + 13);
        context.lineTo(balloonX - 3, balloonY + 24);
        context.moveTo(balloonX + 5, balloonY + 13);
        context.lineTo(balloonX + 3, balloonY + 24);
        context.stroke();
        roundedRect(context, balloonX - 5, balloonY + 22, 10, 7, 2, "#8f5638");
      }

      platforms.forEach((platform, index) => {
        const screenY = toScreenY(platform.y);
        if (screenY < -70 || screenY > worldHeight + 80) return;
        if (platform.type === "bridge") {
          roundedRect(context, platform.x, screenY, platform.width, 13, 5, "#8e4d2d");
          context.fillStyle = "#e6a764";
          for (let x = platform.x + 8; x < platform.x + platform.width - 5; x += 22) {
            roundedRect(context, x, screenY + 2, 16, 8, 2, "#e6a764");
          }
          context.strokeStyle = "#f6d39a";
          context.lineWidth = 2;
          context.beginPath();
          context.moveTo(platform.x, screenY + 1);
          context.lineTo(platform.x + platform.width, screenY + 1);
          context.stroke();
        } else if (platform.type === "cloud") {
          context.fillStyle = "rgba(255,255,255,.9)";
          context.beginPath();
          context.arc(platform.x + 20, screenY + 4, 21, 0, Math.PI * 2);
          context.arc(platform.x + platform.width * 0.5, screenY - 5, 28, 0, Math.PI * 2);
          context.arc(platform.x + platform.width - 20, screenY + 4, 21, 0, Math.PI * 2);
          context.fill();
          roundedRect(context, platform.x, screenY, platform.width, 12, 6, "#dffcff");
        } else if (platform.type === "crate") {
          roundedRect(context, platform.x, screenY - 7, platform.width, 19, 4, "#d78a45");
          context.strokeStyle = "#8a4b2d";
          context.lineWidth = 3;
          context.strokeRect(platform.x + 4, screenY - 4, platform.width - 8, 13);
          context.beginPath();
          context.moveTo(platform.x + 7, screenY - 2);
          context.lineTo(platform.x + platform.width - 7, screenY + 7);
          context.moveTo(platform.x + platform.width - 7, screenY - 2);
          context.lineTo(platform.x + 7, screenY + 7);
          context.stroke();
        } else if (platform.type === "stone") {
          roundedRect(context, platform.x, screenY - 3, platform.width, 18, 6, "#687789");
          context.fillStyle = "rgba(255,255,255,.16)";
          for (let x = platform.x + 9; x < platform.x + platform.width - 8; x += 24) {
            roundedRect(context, x, screenY + 1, 15, 5, 2, "rgba(255,255,255,.16)");
          }
        } else if (platform.type === "metal") {
          roundedRect(context, platform.x, screenY - 2, platform.width, 16, 4, "#304966");
          context.strokeStyle = "#70dbea";
          context.lineWidth = 2;
          context.beginPath();
          context.moveTo(platform.x + 4, screenY);
          context.lineTo(platform.x + platform.width - 4, screenY);
          context.stroke();
          context.fillStyle = "#b7ff3c";
          context.beginPath();
          context.arc(platform.x + 10, screenY + 7, 2, 0, Math.PI * 2);
          context.arc(platform.x + platform.width - 10, screenY + 7, 2, 0, Math.PI * 2);
          context.fill();
        } else {
          roundedRect(context, platform.x, screenY, platform.width, 15, 7, "#173f46");
          roundedRect(context, platform.x, screenY - 4, platform.width, 8, 5, index % 3 === 0 ? "#b7ee3e" : "#53e0a1");
        }

        const decorX = platform.x + Math.min(platform.width - 18, Math.max(18, platform.width * 0.72));
        if (platform.decor === "flag") {
          context.strokeStyle = "#effcff";
          context.lineWidth = 2;
          context.beginPath();
          context.moveTo(decorX, screenY - 4);
          context.lineTo(decorX, screenY - 45);
          context.stroke();
          context.fillStyle = platform.summit === 0 ? "#00e5ff" : "#b7ff3c";
          context.beginPath();
          context.moveTo(decorX + 1, screenY - 44);
          context.lineTo(decorX + 31, screenY - 35);
          context.lineTo(decorX + 1, screenY - 24);
          context.fill();
          if (platform.summit !== null) {
            roundedRect(context, platform.x + 10, screenY + 20, 94, 24, 12, "rgba(5,11,18,.76)");
            context.fillStyle = "#eaffb8";
            context.font = "800 10px system-ui";
            context.textAlign = "center";
            context.fillText(platform.summit === 0 ? "START" : `SUMMIT ${platform.summit}`, platform.x + 57, screenY + 36);
          }
        } else if (platform.decor === "plant") {
          context.strokeStyle = "#153f31";
          context.lineWidth = 3;
          context.beginPath();
          context.moveTo(decorX, screenY - 3);
          context.lineTo(decorX, screenY - 23);
          context.stroke();
          context.fillStyle = "#72ef91";
          context.beginPath();
          context.ellipse(decorX - 6, screenY - 18, 7, 3, -0.5, 0, Math.PI * 2);
          context.ellipse(decorX + 6, screenY - 13, 7, 3, 0.5, 0, Math.PI * 2);
          context.fill();
        } else if (platform.decor === "lamp") {
          context.strokeStyle = "#23384a";
          context.lineWidth = 3;
          context.beginPath();
          context.moveTo(decorX, screenY - 3);
          context.lineTo(decorX, screenY - 27);
          context.stroke();
          context.fillStyle = "rgba(255,224,118,.2)";
          context.beginPath();
          context.arc(decorX, screenY - 29, 11, 0, Math.PI * 2);
          context.fill();
          roundedRect(context, decorX - 5, screenY - 35, 10, 12, 4, "#ffe57c");
        } else if (platform.decor === "coin") {
          context.fillStyle = "rgba(255,213,75,.22)";
          context.beginPath();
          context.arc(decorX, screenY - 25, 13, 0, Math.PI * 2);
          context.fill();
          context.fillStyle = "#ffd84b";
          context.beginPath();
          context.arc(decorX, screenY - 25, 8, 0, Math.PI * 2);
          context.fill();
          context.fillStyle = "#73520a";
          context.font = "900 8px system-ui";
          context.textAlign = "center";
          context.fillText("฿", decorX, screenY - 22);
        }
      });

      const playerScreenY = toScreenY(player.y) - PLAYER_HEIGHT;
      context.save();
      context.translate(player.x, playerScreenY);
      if (player.vx < -8) context.scale(-1, 1);
      context.fillStyle = "#10263b";
      context.beginPath();
      context.moveTo(-10, 7);
      context.lineTo(-4, -2);
      context.lineTo(-25 - Math.min(8, Math.abs(player.vx) * 0.04), 13);
      context.fill();
      roundedRect(context, -19, 9, 12, 22, 5, "#ff8c63");
      context.fillStyle = "#ffe08a";
      context.font = "900 8px system-ui";
      context.textAlign = "center";
      context.fillText("฿", -13, 23);
      context.fillStyle = "#30e0bd";
      context.beginPath();
      context.roundRect(-PLAYER_WIDTH / 2, 4, PLAYER_WIDTH, 30, 13);
      context.fill();
      context.strokeStyle = "#136d72";
      context.lineWidth = 4;
      context.lineCap = "round";
      context.beginPath();
      context.moveTo(-13, 13);
      context.lineTo(-20, 21 + Math.min(4, Math.abs(player.vy) * 0.01));
      context.moveTo(13, 13);
      context.lineTo(20, 19 - Math.min(4, Math.abs(player.vy) * 0.01));
      context.stroke();
      context.fillStyle = "#10263b";
      context.beginPath();
      context.ellipse(-8, 35, 7, 3.5, -0.08, 0, Math.PI * 2);
      context.ellipse(8, 35, 7, 3.5, 0.08, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "#dfff5f";
      context.beginPath();
      context.moveTo(-11, -8);
      context.lineTo(-4, -17);
      context.lineTo(0, -7);
      context.moveTo(11, -8);
      context.lineTo(4, -17);
      context.lineTo(0, -7);
      context.fill();
      context.beginPath();
      context.arc(0, 0, 14, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "#071019";
      context.beginPath();
      context.arc(-5, -1, 2.4, 0, Math.PI * 2);
      context.arc(5, -1, 2.4, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = "#071019";
      context.lineWidth = 1.6;
      context.beginPath();
      context.arc(0, 3, 4, 0.2, Math.PI - 0.2);
      context.stroke();
      context.fillStyle = "#ff8ea5";
      context.beginPath();
      context.arc(-9, 4, 2.2, 0, Math.PI * 2);
      context.arc(9, 4, 2.2, 0, Math.PI * 2);
      context.fill();
      context.restore();
      context.restore();
    }

    function frame(timestamp: number) {
      const context = canvas?.getContext("2d");
      if (!canvas || !context) return;
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      if (canvas.width !== Math.round(rect.width * ratio) || canvas.height !== Math.round(rect.height * ratio)) {
        canvas.width = Math.round(rect.width * ratio);
        canvas.height = Math.round(rect.height * ratio);
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      const delta = lastFrameRef.current ? Math.min(0.034, (timestamp - lastFrameRef.current) / 1000) : 0;
      lastFrameRef.current = timestamp;
      const player = physicsRef.current;

      if (!quizOpenRef.current && Date.now() < endAt) {
        const direction = (inputRef.current.right ? 1 : 0) - (inputRef.current.left ? 1 : 0);
        const targetVelocity = direction * 175;
        player.vx += (targetVelocity - player.vx) * Math.min(1, delta * 11);
        if (!direction) player.vx *= Math.max(0, 1 - delta * 7);
        player.x += player.vx * delta;
        if (player.x < PLAYER_WIDTH / 2) {
          player.x = PLAYER_WIDTH / 2;
          player.vx = Math.abs(player.vx) * 0.35;
        }
        if (player.x > WORLD_WIDTH - PLAYER_WIDTH / 2) {
          player.x = WORLD_WIDTH - PLAYER_WIDTH / 2;
          player.vx = -Math.abs(player.vx) * 0.35;
        }
        if (direction) energyRef.current = Math.max(0, energyRef.current - delta * 1.8);

        const previousY = player.y;
        player.vy -= 1050 * delta;
        player.y += player.vy * delta;
        if (player.vy <= 0) {
          for (let index = platforms.length - 1; index >= 0; index -= 1) {
            const platform = platforms[index];
            if (platform.y > previousY + 2 || platform.y < player.y - 3) continue;
            const overlaps = player.x + PLAYER_WIDTH / 2 > platform.x && player.x - PLAYER_WIDTH / 2 < platform.x + platform.width;
            if (overlaps) {
              player.y = platform.y;
              player.vy = 0;
              player.jumps = 0;
              if (platform.y >= platforms[player.checkpointIndex].y) player.checkpointIndex = index;
              break;
            }
          }
        }

        const currentHeight = Math.max(0, Math.floor(player.y / 10));
        if (currentHeight > maxHeightRef.current) maxHeightRef.current = currentHeight;
        player.cameraBottom += (Math.max(0, player.y - 185) - player.cameraBottom) * Math.min(1, delta * 4.5);

        if (player.y < player.cameraBottom - 230) {
          const checkpointY = platforms[player.checkpointIndex]?.y ?? 0;
          let respawnIndex = 0;
          for (let index = 0; index < platforms.length; index += 1) {
            if (platforms[index].y <= Math.max(0, checkpointY - 105)) respawnIndex = index;
            else break;
          }
          const respawn = platforms[respawnIndex];
          player.checkpointIndex = respawnIndex;
          player.x = respawn.x + respawn.width / 2;
          player.y = respawn.y + 2;
          player.vx = 0;
          player.vy = 0;
          player.jumps = 0;
          player.cameraBottom = Math.max(0, respawn.y - 95);
          energyRef.current = Math.max(0, energyRef.current - 4);
          setToast("ไม่เป็นไร! กลับมาที่จุดปลอดภัยแล้ว");
        }

        if (energyRef.current <= ENERGY_THRESHOLD && !quizOpenRef.current) openQuiz(true);
        if (timestamp - lastHudRef.current > 100) {
          lastHudRef.current = timestamp;
          setEnergy(Math.round(energyRef.current));
          setMaxHeight(maxHeightRef.current);
        }
      }

      draw(context, rect.width, rect.height);

      if (timestamp - lastSyncRef.current > 3000 && Date.now() < endAt) {
        lastSyncRef.current = timestamp;
        void fetch(`/api/rooms/${code}/jump/progress`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            playerToken: token,
            maxHeight: maxHeightRef.current,
            energy: Math.round(energyRef.current),
            questionIndex: questionIndexRef.current,
          }),
        }).then((response) => {
          if (!response.ok) void onRefresh();
        }).catch(() => undefined);
      }
      animation = window.requestAnimationFrame(frame);
    }

    animation = window.requestAnimationFrame(frame);
    return () => window.cancelAnimationFrame(animation);
  }, [code, endAt, onRefresh, openQuiz, platforms, token]);

  useEffect(() => {
    if (secondsLeft > 0 || finalSyncSentRef.current) return;
    finalSyncSentRef.current = true;
    inputRef.current.left = false;
    inputRef.current.right = false;
    quizOpenRef.current = true;
    const finalSync = window.setTimeout(() => {
      void fetch(`/api/rooms/${code}/jump/progress`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerToken: token,
          maxHeight: maxHeightRef.current,
          energy: Math.round(energyRef.current),
          questionIndex: questionIndexRef.current,
        }),
      }).finally(() => void onRefresh());
    }, 0);
    return () => window.clearTimeout(finalSync);
  }, [code, onRefresh, secondsLeft, token]);

  const difficulty = maxHeight < 250 ? "เริ่มต้น" : maxHeight < 650 ? "คล่องตัว" : maxHeight < 1100 ? "ท้าทาย" : "ยอดนักกระโดด";
  const summitNumber = Math.min(6, Math.floor(maxHeight / 190) + 1);

  return (
    <section className="jump-game-shell">
      <div className="jump-hud">
        <div className="jump-hud-card"><span>สูงสุด</span><strong>{maxHeight} ม.</strong></div>
        <div className="jump-hud-card jump-time"><span>เวลา</span><strong>{formatTime(secondsLeft)}</strong></div>
        <button className="jump-quiz-shortcut" onClick={() => openQuiz(false)}>+ Quiz</button>
      </div>
      <div className="energy-panel">
        <div className="energy-label"><span>⚡ พลังงาน</span><strong>{energy}/100</strong></div>
        <div className="energy-track"><span style={{ width: `${energy}%` }} /></div>
      </div>
      <div className="jump-level-chip">ยอดเขา {summitNumber}/6 · {difficulty} · Quiz {score} คะแนน</div>
      <canvas ref={canvasRef} className="jump-canvas" aria-label="เกมกระโดดขึ้นที่สูง" />
      {toast && <button className="jump-toast" onClick={() => setToast("")}>{toast}<span>×</span></button>}
      <div className="jump-controls" aria-label="ปุ่มควบคุมเกม">
        <div className="move-pad" aria-label="ปุ่มเดินซ้ายและขวา">
          <button
            className="move-button"
            onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); inputRef.current.left = true; }}
            onPointerUp={() => { inputRef.current.left = false; }}
            aria-label="เดินซ้าย"
          >←</button>
          <button
            className="move-button"
            onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); inputRef.current.right = true; }}
            onPointerUp={() => { inputRef.current.right = false; }}
            aria-label="เดินขวา"
          >→</button>
        </div>
        <button className="jump-button" onPointerDown={(event) => { event.preventDefault(); jump(); }} aria-label="กระโดด">
          <span>↑</span><strong>กระโดด</strong><small>กดได้เมื่อแตะพื้น</small>
        </button>
      </div>

      {quizOpen && (
        <div className="jump-quiz-overlay" role="dialog" aria-modal="true" aria-label="คำถามเติมพลัง">
          <section className="jump-quiz-card">
            {!answerResult ? (
              <>
                <header>
                  <div><span className="quiz-energy-icon">⚡</span><div><p>เติมพลังด้วย Quiz</p><small>ข้อ {activeQuestion.number}/{activeQuestion.total}</small></div></div>
                  <strong className="no-question-timer">ไม่จับเวลา</strong>
                </header>
                <p className="quiz-loop-note">คำถามจะวนต่อเนื่องจนหมดเวลาการแข่งขัน</p>
                <h2>{activeQuestion.prompt}</h2>
                <div className="jump-answer-grid">
                  {activeQuestion.options.map((option, index) => (
                    <button className={ANSWER_STYLES[index]} disabled={answering} onClick={() => void submitAnswer(index)} key={`${activeQuestion.index}-${index}`}>
                      <span>{ANSWER_ICONS[index]}</span><strong>{option}</strong>
                    </button>
                  ))}
                </div>
                {answering && <p className="quiz-sending">กำลังตรวจคำตอบ…</p>}
                {quizError && <p className="quiz-error">{quizError}</p>}
              </>
            ) : (
              <div className={`jump-answer-result ${answerResult.isCorrect ? "correct" : "wrong"}`}>
                <span className="result-face">{answerResult.isCorrect ? "✓" : "×"}</span>
                <p>{answerResult.isCorrect ? "ตอบถูก เก่งมาก!" : "ยังไม่ถูก แต่ได้พลังกลับมานิดหน่อย"}</p>
                <h2>+{answerResult.points} คะแนน · +{answerResult.energyGain} พลัง</h2>
                {!answerResult.isCorrect && <div className="correct-answer-line">คำตอบที่ถูก: {activeQuestion.options[answerResult.correctIndex]}</div>}
                {answerResult.explanation && <div className="jump-explanation">{answerResult.explanation}</div>}
                <div className="jump-result-actions">
                  <button className="secondary-button" onClick={nextQuiz}>ตอบอีกข้อ + คะแนน</button>
                  <button className="primary-button" onClick={closeQuiz} disabled={energyRef.current <= ENERGY_THRESHOLD}>กลับไปกระโดด →</button>
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
