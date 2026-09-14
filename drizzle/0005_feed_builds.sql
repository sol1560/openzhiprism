CREATE TABLE `feed_builds` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`date` text NOT NULL,
	`status` text NOT NULL,
	`stage` text,
	`stage_index` integer DEFAULT 0 NOT NULL,
	`stage_total` integer DEFAULT 0 NOT NULL,
	`detail` text,
	`error` text,
	`force` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `feed_builds_user_date_idx` ON `feed_builds` (`user_id`,`date`);