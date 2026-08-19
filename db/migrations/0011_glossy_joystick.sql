CREATE TABLE "web_vitals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"route" text NOT NULL,
	"metric" text NOT NULL,
	"value" double precision NOT NULL,
	"rating" text NOT NULL,
	"device_type" text,
	"recorded_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "web_vitals_metric_known" CHECK ("web_vitals"."metric" in ('LCP', 'CLS', 'INP', 'FCP', 'TTFB')),
	CONSTRAINT "web_vitals_rating_known" CHECK ("web_vitals"."rating" in ('good', 'needs-improvement', 'poor')),
	CONSTRAINT "web_vitals_value_finite" CHECK ("web_vitals"."value" >= 0)
);
--> statement-breakpoint
CREATE INDEX "web_vitals_report_idx" ON "web_vitals" USING btree ("recorded_at","route","metric");