ALTER TABLE `rooms` ADD `game_mode` text DEFAULT 'quiz' NOT NULL;--> statement-breakpoint
ALTER TABLE `rooms` ADD `game_duration_seconds` integer DEFAULT 300 NOT NULL;--> statement-breakpoint
ALTER TABLE `rooms` ADD `game_started_at` integer;--> statement-breakpoint
ALTER TABLE `players` ADD `max_height` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `players` ADD `energy` integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE `players` ADD `jump_question_index` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `players_room_height_idx` ON `players` (`room_id`,`max_height`);
