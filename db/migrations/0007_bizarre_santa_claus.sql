CREATE TABLE "event_exdates" (
	"event_id" uuid NOT NULL,
	"date" date NOT NULL,
	CONSTRAINT "event_exdates_event_id_date_pk" PRIMARY KEY("event_id","date")
);
--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN "repeat_freq" text;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN "repeat_interval" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN "repeat_weekdays" jsonb;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN "repeat_until" date;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN "series_id" uuid;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN "original_date" date;--> statement-breakpoint
ALTER TABLE "event_exdates" ADD CONSTRAINT "event_exdates_event_id_calendar_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."calendar_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_series_id_calendar_events_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."calendar_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_events_series_original_uq" ON "calendar_events" USING btree ("series_id","original_date") WHERE "calendar_events"."series_id" is not null;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_repeat_freq_valid" CHECK ("calendar_events"."repeat_freq" is null or "calendar_events"."repeat_freq" in ('daily', 'weekly', 'monthly', 'yearly'));--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_repeat_interval_range" CHECK ("calendar_events"."repeat_interval" between 1 and 99);