ALTER TABLE "calendar_events" ADD COLUMN "start_time" time;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN "end_time" time;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN "location" text;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN "url" text;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN "colour" text;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN "attendee_ids" jsonb;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN "pinned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN "updated_at" timestamp (3) DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "calendar_events_household_start_idx" ON "calendar_events" USING btree ("household_id","start_date");