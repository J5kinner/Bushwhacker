CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"keys" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE "reminder_log" (
	"event_id" uuid NOT NULL,
	"occurrence_date" date NOT NULL,
	"sent_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "reminder_log_event_id_occurrence_date_pk" PRIMARY KEY("event_id","occurrence_date")
);
--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN "reminder_minutes" smallint;--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN "timezone" text DEFAULT 'Australia/Sydney' NOT NULL;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_log" ADD CONSTRAINT "reminder_log_event_id_calendar_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."calendar_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_reminder_minutes_range" CHECK ("calendar_events"."reminder_minutes" is null or "calendar_events"."reminder_minutes" between -1440 and 10080);