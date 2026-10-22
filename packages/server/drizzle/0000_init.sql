CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`seq` integer NOT NULL,
	`sender_type` text NOT NULL,
	`participant_id` text,
	`user_id` text,
	`kind` text NOT NULL,
	`content` text NOT NULL,
	`mentions` text NOT NULL,
	`reply_to_seq` integer,
	`evidence` text NOT NULL,
	`ready` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `messages_room_seq_uq` ON `messages` (`room_id`,`seq`);--> statement-breakpoint
CREATE TABLE `participants` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`display_name` text NOT NULL,
	`repo` text,
	`client` text,
	`status` text NOT NULL,
	`last_seen_at` integer NOT NULL,
	`joined_at` integer NOT NULL,
	`left_at` integer,
	`leave_summary` text,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `participants_room_idx` ON `participants` (`room_id`);--> statement-breakpoint
CREATE TABLE `reply_tokens` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`participant_id` text NOT NULL,
	`room_id` text NOT NULL,
	`issued_at_seq` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer
);
--> statement-breakpoint
CREATE INDEX `reply_tokens_expiry_idx` ON `reply_tokens` (`expires_at`);--> statement-breakpoint
CREATE TABLE `rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`type` text NOT NULL,
	`stage` text NOT NULL,
	`status` text NOT NULL,
	`host_participant_id` text,
	`created_by` text NOT NULL,
	`settings` text NOT NULL,
	`created_at` integer NOT NULL,
	`closed_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rooms_slug_unique` ON `rooms` (`slug`);