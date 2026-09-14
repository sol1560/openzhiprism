CREATE TABLE `feed_directives` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`topic` text,
	`direction` text,
	`text` text NOT NULL,
	`source_text` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `feed_directives_user_idx` ON `feed_directives` (`user_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `feed_items` ADD `summary_override` text;--> statement-breakpoint
ALTER TABLE `feed_items` ADD `override_note` text;