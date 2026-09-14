CREATE TABLE `login_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`code_hash` text NOT NULL,
	`browser_hash` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer
);
--> statement-breakpoint
CREATE INDEX `login_codes_email_idx` ON `login_codes` (`email`,`created_at`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_oauth_identities` (
	`provider` text DEFAULT 'zhihu' NOT NULL,
	`subject` text NOT NULL,
	`user_id` text NOT NULL,
	`email` text,
	`created_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`provider`, `subject`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_oauth_identities`("provider", "subject", "user_id", "email", "created_at") SELECT 'zhihu', "subject", "user_id", NULL, 0 FROM `oauth_identities`;--> statement-breakpoint
DROP TABLE `oauth_identities`;--> statement-breakpoint
ALTER TABLE `__new_oauth_identities` RENAME TO `oauth_identities`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `oauth_identities_user_idx` ON `oauth_identities` (`user_id`);--> statement-breakpoint
ALTER TABLE `users` ADD `email` text;--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_idx` ON `users` (`email`);