CREATE TABLE `board_history` (
	`room_id` text NOT NULL,
	`key` text NOT NULL,
	`version` integer NOT NULL,
	`content` text NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`room_id`, `key`, `version`)
);
--> statement-breakpoint
CREATE TABLE `board_sections` (
	`room_id` text NOT NULL,
	`key` text NOT NULL,
	`content` text NOT NULL,
	`version` integer NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`room_id`, `key`),
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `messages` ADD `sender_name` text;--> statement-breakpoint
ALTER TABLE `rooms` ADD `stage_started_seq` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `rooms` ADD `budget_start_seq` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `rooms` ADD `last_message_at` integer DEFAULT 0 NOT NULL;