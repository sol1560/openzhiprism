CREATE TABLE `api_usage` (
	`provider` text NOT NULL,
	`endpoint` text NOT NULL,
	`date` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`provider`, `endpoint`, `date`)
);
--> statement-breakpoint
CREATE TABLE `content_cache` (
	`content_id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`excerpt` text DEFAULT '' NOT NULL,
	`url` text NOT NULL,
	`author_name` text,
	`author_avatar` text,
	`vote_up` integer DEFAULT 0 NOT NULL,
	`comment_count` integer DEFAULT 0 NOT NULL,
	`thumbnail_url` text,
	`query` text,
	`summary` text,
	`summary_model` text,
	`fetched_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `content_cache_query_idx` ON `content_cache` (`query`);--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`source` text NOT NULL,
	`title` text,
	`content` text NOT NULL,
	`message_count` integer DEFAULT 0 NOT NULL,
	`redacted_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`processed_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `conversations_user_idx` ON `conversations` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `feed_items` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`date` text NOT NULL,
	`position` integer NOT NULL,
	`kind` text NOT NULL,
	`content_id` text,
	`topic_id` text,
	`topic_name` text,
	`reason` text DEFAULT '' NOT NULL,
	`payload` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`content_id`) REFERENCES `content_cache`(`content_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`topic_id`) REFERENCES `interest_topics`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `feed_items_user_date_idx` ON `feed_items` (`user_id`,`date`,`position`);--> statement-breakpoint
CREATE TABLE `feed_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`date` text NOT NULL,
	`source_used` text NOT NULL,
	`llm_used` text NOT NULL,
	`stats` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `interest_topics` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`weight` real DEFAULT 0 NOT NULL,
	`raw_score` real DEFAULT 0 NOT NULL,
	`hits` integer DEFAULT 1 NOT NULL,
	`keywords` text DEFAULT '[]' NOT NULL,
	`questions` text DEFAULT '[]' NOT NULL,
	`evidence` text DEFAULT '[]' NOT NULL,
	`search_queries` text DEFAULT '[]' NOT NULL,
	`controversial` integer DEFAULT false NOT NULL,
	`stance` text,
	`stance_label` text,
	`source` text DEFAULT 'conversation' NOT NULL,
	`last_seen_at` integer DEFAULT (unixepoch()) NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `interest_topics_user_name_idx` ON `interest_topics` (`user_id`,`name`);--> statement-breakpoint
CREATE INDEX `interest_topics_user_weight_idx` ON `interest_topics` (`user_id`,`weight`);--> statement-breakpoint
CREATE TABLE `perspective_cache` (
	`topic_key` text PRIMARY KEY NOT NULL,
	`topic_name` text NOT NULL,
	`question` text NOT NULL,
	`is_controversial` integer DEFAULT false NOT NULL,
	`stances` text DEFAULT '[]' NOT NULL,
	`analysis` text,
	`model` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `seen_items` (
	`user_id` text NOT NULL,
	`content_id` text NOT NULL,
	`seen_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`user_id`, `content_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`avatar_url` text,
	`headline` text,
	`zhihu_url_token` text,
	`login_source` text DEFAULT 'demo' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
