import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const rooms = sqliteTable(
  "rooms",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    hostToken: text("host_token").notNull(),
    phase: text("phase").notNull().default("lobby"),
    currentQuestion: integer("current_question").notNull().default(-1),
    questionStartedAt: integer("question_started_at"),
    questionCount: integer("question_count").notNull().default(10),
    questionSeconds: integer("question_seconds").notNull().default(15),
    selectedQuestions: text("selected_questions")
      .notNull()
      .default("[0,1,2,3,4,5,6,7,8,9]"),
    maxPlayers: integer("max_players").notNull().default(150),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [uniqueIndex("rooms_code_unique").on(table.code)]
);

export const players = sqliteTable(
  "players",
  {
    id: text("id").primaryKey(),
    roomId: text("room_id").notNull(),
    nickname: text("nickname").notNull(),
    nicknameKey: text("nickname_key").notNull(),
    token: text("token").notNull(),
    score: integer("score").notNull().default(0),
    correctCount: integer("correct_count").notNull().default(0),
    totalResponseMs: integer("total_response_ms").notNull().default(0),
    joinedAt: integer("joined_at").notNull(),
    lastSeenAt: integer("last_seen_at").notNull(),
  },
  (table) => [
    uniqueIndex("players_room_nickname_unique").on(table.roomId, table.nicknameKey),
    uniqueIndex("players_token_unique").on(table.token),
    index("players_room_score_idx").on(table.roomId, table.score),
  ]
);

export const answers = sqliteTable(
  "answers",
  {
    id: text("id").primaryKey(),
    roomId: text("room_id").notNull(),
    playerId: text("player_id").notNull(),
    questionIndex: integer("question_index").notNull(),
    answerIndex: integer("answer_index").notNull(),
    isCorrect: integer("is_correct", { mode: "boolean" }).notNull(),
    responseMs: integer("response_ms").notNull(),
    points: integer("points").notNull(),
    answeredAt: integer("answered_at").notNull(),
  },
  (table) => [
    uniqueIndex("answers_player_question_unique").on(
      table.roomId,
      table.playerId,
      table.questionIndex
    ),
    index("answers_room_question_idx").on(table.roomId, table.questionIndex),
  ]
);
