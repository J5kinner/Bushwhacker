import { getDb, isDbConfigured } from "@/db";
import { webVitals } from "@/db/schema";
import { parseVitalReport } from "@/lib/web-vitals";

/**
 * Web Vitals ingest for components/web-vitals-reporter.tsx.
 *
 * A Route Handler rather than a Server Action because the browser sends this
 * with sendBeacon during page unload, which can only issue a plain POST.
 *
 * Unauthenticated by necessity: proxy.ts excludes /api, and the sign-in page's
 * own load performance is worth measuring, so there is no session to check.
 * What makes that acceptable is that the body is validated to a fixed shape and
 * nothing about the caller is stored — the worst an abuser achieves is junk
 * rows in a performance table, bounded by the rate limit below.
 *
 * Every outcome is 204. The sender is a fire-and-forget beacon that cannot
 * react to a status code, and a error would only invite a retry.
 */
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 60;

let windowStartedAt = 0;
let windowCount = 0;

/**
 * A deliberately crude in-memory cap. Serverless gives each instance its own
 * counter, so this is not a real distributed rate limit — it bounds a single
 * runaway client, which for a two-person app is the only case that exists.
 */
function withinRateLimit(now: number): boolean {
  if (now - windowStartedAt > WINDOW_MS) {
    windowStartedAt = now;
    windowCount = 0;
  }
  windowCount += 1;
  return windowCount <= MAX_PER_WINDOW;
}

export async function POST(request: Request) {
  if (!isDbConfigured() || !withinRateLimit(Date.now())) return noContent();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return noContent();
  }

  const report = parseVitalReport(body);
  if (!report) return noContent();

  try {
    await getDb().insert(webVitals).values(report);
  } catch (error) {
    console.error(
      JSON.stringify({ evt: "vitals_insert_failed", metric: report.metric }),
      error,
    );
  }

  return noContent();
}

function noContent() {
  return new Response(null, { status: 204 });
}
