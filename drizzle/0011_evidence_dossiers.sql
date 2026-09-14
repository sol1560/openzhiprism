CREATE TABLE `content_feedback` (
	`user_id` text NOT NULL,
	`content_id` text NOT NULL,
	`kind` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `content_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `dossier_access` (
	`user_id` text NOT NULL,
	`job_id` text NOT NULL,
	`artifact_id` text NOT NULL,
	PRIMARY KEY(`user_id`, `job_id`, `artifact_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`job_id`) REFERENCES `dossier_jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`artifact_id`) REFERENCES `dossier_artifacts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `dossier_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`cache_key` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dossier_artifacts_cache_key_unique` ON `dossier_artifacts` (`cache_key`);--> statement-breakpoint
CREATE TABLE `dossier_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`topic_key` text NOT NULL,
	`topic` text NOT NULL,
	`status` text NOT NULL,
	`stage` text NOT NULL,
	`lease` text NOT NULL,
	`error` text,
	`source_ids` text DEFAULT '[]' NOT NULL,
	`evidence` text DEFAULT '[]' NOT NULL,
	`artifact_id` text,
	`updated_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`artifact_id`) REFERENCES `dossier_artifacts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dossier_job_user_topic_idx` ON `dossier_jobs` (`user_id`,`topic_key`);--> statement-breakpoint
CREATE TABLE `inquiries` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`input_hash` text NOT NULL,
	`revision` integer NOT NULL,
	`payload` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `inquiry_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`inquiry_id` text NOT NULL,
	`input_hash` text NOT NULL,
	`result` text NOT NULL,
	FOREIGN KEY (`inquiry_id`) REFERENCES `inquiries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `reflection_versions` (
	`reflection_id` text NOT NULL,
	`version` integer NOT NULL,
	`request_id` text NOT NULL,
	`input_hash` text NOT NULL,
	`payload` text NOT NULL,
	PRIMARY KEY(`reflection_id`, `version`),
	FOREIGN KEY (`reflection_id`) REFERENCES `reflections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reflection_request_idx` ON `reflection_versions` (`reflection_id`,`request_id`);--> statement-breakpoint
CREATE TABLE `reflections` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`job_id` text NOT NULL,
	`topic` text NOT NULL,
	`following` integer DEFAULT false NOT NULL,
	`revision` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`job_id`) REFERENCES `dossier_jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `reflection_user_idx` ON `reflections` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `source_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`content_id` text NOT NULL,
	`hash` text NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_snapshot_version_idx` ON `source_snapshots` (`content_id`,`hash`);