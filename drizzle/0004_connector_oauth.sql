CREATE TABLE `connector_clients` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`redirect_uris` text NOT NULL,
	`auth_method` text NOT NULL,
	`grant_types` text NOT NULL,
	`secret_hash` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `connector_credentials` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`grant_id` text NOT NULL,
	`kind` text NOT NULL,
	`redirect_uri` text,
	`challenge` text,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	FOREIGN KEY (`grant_id`) REFERENCES `connector_grants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `connector_credentials_grant_idx` ON `connector_credentials` (`grant_id`);--> statement-breakpoint
CREATE TABLE `connector_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`client_id` text NOT NULL,
	`scope` text NOT NULL,
	`resource` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`client_id`) REFERENCES `connector_clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `connector_grants_user_idx` ON `connector_grants` (`user_id`);--> statement-breakpoint
CREATE TABLE `connector_requests` (
	`request_hash` text PRIMARY KEY NOT NULL,
	`browser_hash` text NOT NULL,
	`client_id` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`state` text,
	`challenge` text NOT NULL,
	`scope` text NOT NULL,
	`resource` text NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	FOREIGN KEY (`client_id`) REFERENCES `connector_clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `oauth_transactions` ADD `return_to` text;