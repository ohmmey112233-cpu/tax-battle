ALTER TABLE `rooms` ADD `question_count` integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE `rooms` ADD `question_seconds` integer DEFAULT 15 NOT NULL;--> statement-breakpoint
ALTER TABLE `rooms` ADD `selected_questions` text DEFAULT '[0,1,2,3,4,5,6,7,8,9]' NOT NULL;