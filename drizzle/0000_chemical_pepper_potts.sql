CREATE TABLE `answers` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`player_id` text NOT NULL,
	`question_index` integer NOT NULL,
	`answer_index` integer NOT NULL,
	`is_correct` integer NOT NULL,
	`response_ms` integer NOT NULL,
	`points` integer NOT NULL,
	`answered_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `answers_player_question_unique` ON `answers` (`room_id`,`player_id`,`question_index`);--> statement-breakpoint
CREATE INDEX `answers_room_question_idx` ON `answers` (`room_id`,`question_index`);--> statement-breakpoint
CREATE TABLE `players` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`nickname` text NOT NULL,
	`nickname_key` text NOT NULL,
	`token` text NOT NULL,
	`score` integer DEFAULT 0 NOT NULL,
	`correct_count` integer DEFAULT 0 NOT NULL,
	`total_response_ms` integer DEFAULT 0 NOT NULL,
	`joined_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `players_room_nickname_unique` ON `players` (`room_id`,`nickname_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `players_token_unique` ON `players` (`token`);--> statement-breakpoint
CREATE INDEX `players_room_score_idx` ON `players` (`room_id`,`score`);--> statement-breakpoint
CREATE TABLE `rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`host_token` text NOT NULL,
	`phase` text DEFAULT 'lobby' NOT NULL,
	`current_question` integer DEFAULT -1 NOT NULL,
	`question_started_at` integer,
	`max_players` integer DEFAULT 120 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rooms_code_unique` ON `rooms` (`code`);