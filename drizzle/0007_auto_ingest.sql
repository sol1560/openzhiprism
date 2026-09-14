ALTER TABLE `connector_grants` ADD `auto_ingest` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `conversations` ADD `content_hash` text;--> statement-breakpoint
CREATE INDEX `conversations_hash_idx` ON `conversations` (`user_id`,`content_hash`);