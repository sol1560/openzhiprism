CREATE TABLE `auth_credentials` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `auth_credentials_user_idx` ON `auth_credentials` (`user_id`,`kind`);--> statement-breakpoint
CREATE TABLE `detection_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`content_id` text NOT NULL,
	`text_hash` text NOT NULL,
	`model` text NOT NULL,
	`processing_version` text NOT NULL,
	`status` text NOT NULL,
	`task_id` text,
	`source_text` text NOT NULL,
	`source_provider` text NOT NULL,
	`source_fetched_at` integer,
	`source_truncated` integer,
	`result` text,
	`error_code` text,
	`created_at` integer NOT NULL,
	`checked_at` integer,
	`next_poll_at` integer DEFAULT 0 NOT NULL,
	`poll_lease` text,
	FOREIGN KEY (`content_id`) REFERENCES `content_cache`(`content_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `detection_content_version_idx` ON `detection_jobs` (`content_id`,`text_hash`,`model`,`processing_version`);--> statement-breakpoint
CREATE TABLE `detection_reservations` (
	`job_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`cents` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `detection_jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `detection_reservation_time_idx` ON `detection_reservations` (`created_at`);--> statement-breakpoint
CREATE INDEX `detection_reservation_user_idx` ON `detection_reservations` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `oauth_identities` (
	`subject` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `oauth_transactions` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`browser_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer
);
--> statement-breakpoint
CREATE TABLE `request_gates` (
	`key` text PRIMARY KEY NOT NULL,
	`next_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `content_cache` ADD `source_text` text;--> statement-breakpoint
ALTER TABLE `content_cache` ADD `source_hash` text;--> statement-breakpoint
ALTER TABLE `content_cache` ADD `source_provider` text;--> statement-breakpoint
ALTER TABLE `content_cache` ADD `source_fetched_at` integer;--> statement-breakpoint
ALTER TABLE `content_cache` ADD `source_truncated` integer;