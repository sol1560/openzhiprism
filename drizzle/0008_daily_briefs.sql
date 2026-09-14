CREATE TABLE `daily_briefs` (
	`user_id` text NOT NULL,
	`date` text NOT NULL,
	`payload` text NOT NULL,
	`model` text DEFAULT 'rules' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`user_id`, `date`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
