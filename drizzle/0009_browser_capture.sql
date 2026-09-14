CREATE TABLE `capture_feed_refreshes` (
	`user_id` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`token` text,
	`lease_expires_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `capture_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`grant_id` text NOT NULL,
	`platform` text NOT NULL,
	`external_id` text NOT NULL,
	`snapshot_hash` text NOT NULL,
	`payload` text NOT NULL,
	`redacted_count` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`stage` text DEFAULT '等待分析' NOT NULL,
	`result` text,
	`checkpoint` text,
	`error` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`lease_token` text,
	`lease_expires_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`grant_id`) REFERENCES `connector_grants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `capture_jobs_snapshot_idx` ON `capture_jobs` (`user_id`,`platform`,`external_id`,`snapshot_hash`);--> statement-breakpoint
CREATE INDEX `capture_jobs_user_idx` ON `capture_jobs` (`user_id`,`status`);--> statement-breakpoint
CREATE TABLE `capture_messages` (
	`conversation_id` text NOT NULL,
	`message_id` text NOT NULL,
	`content_hash` text NOT NULL,
	PRIMARY KEY(`conversation_id`, `message_id`, `content_hash`),
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `capture_workers` (
	`user_id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `conversations` ADD `platform` text;--> statement-breakpoint
ALTER TABLE `conversations` ADD `external_id` text;--> statement-breakpoint
ALTER TABLE `conversations` ADD `source_url` text;--> statement-breakpoint
ALTER TABLE `conversations` ADD `captured_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `conversations_external_idx` ON `conversations` (`user_id`,`platform`,`external_id`);