"use server";

import { eq } from "drizzle-orm";
import { updateTag } from "next/cache";
import { getDb } from "@/db";
import { chores } from "@/db/schema";
import { getHouseholdId, getCurrentUserId } from "@/lib/household";
import { scoreChoreLoad, type Rating0to3 } from "@/lib/chore-load";
import { CACHE_TAGS } from "@/lib/queries";

// A chore needs both a seeded household and a household member to own the
// thinking for it (chores.owner_id is NOT NULL), so these writes fail closed on
// either missing piece rather than throwing a 500 at the user — the SetupNotice
// on the page says which step is missing.

const clamp = (n: number, max: number) =>
  Math.max(0, Math.min(max, Math.round(n)));

export interface AddChoreInput {
  title: string;
  anticipate: number;
  identify: number;
  decide: number;
  monitor: number;
  invisible: boolean;
  fragmentation: number;
  intervalDays?: number | null;
}

export async function addChore(input: AddChoreInput) {
  const title = input.title.trim();
  if (!title) return;

  const householdId = await getHouseholdId();
  const ownerId = await getCurrentUserId();
  if (!householdId || !ownerId) return;

  const ratings = {
    anticipate: clamp(input.anticipate, 3) as Rating0to3,
    identify: clamp(input.identify, 3) as Rating0to3,
    decide: clamp(input.decide, 3) as Rating0to3,
    monitor: clamp(input.monitor, 3) as Rating0to3,
    invisible: input.invisible,
    fragmentation: clamp(input.fragmentation, 2) as 0 | 1 | 2,
  };
  const { score, band } = scoreChoreLoad(ratings);

  const intervalDays =
    input.intervalDays && input.intervalDays > 0
      ? clamp(input.intervalDays, 3650)
      : null;

  await getDb()
    .insert(chores)
    .values({
      householdId,
      ownerId,
      title,
      ...ratings,
      cliScore: score,
      cliBand: band,
      intervalDays,
      nextDueAt: intervalDays ? new Date() : null,
    });

  updateTag(CACHE_TAGS.chores);
}

export async function completeChore(id: string) {
  const householdId = await getHouseholdId();
  const userId = await getCurrentUserId();
  if (!householdId || !userId) return;

  const [chore] = await getDb()
    .select({ intervalDays: chores.intervalDays })
    .from(chores)
    .where(eq(chores.id, id))
    .limit(1);

  const now = new Date();
  const nextDueAt =
    chore?.intervalDays && chore.intervalDays > 0
      ? new Date(now.getTime() + chore.intervalDays * 86_400_000)
      : null;

  await getDb()
    .update(chores)
    .set({ lastCompletedAt: now, lastCompletedById: userId, nextDueAt })
    .where(eq(chores.id, id));

  updateTag(CACHE_TAGS.chores);
}

export async function deleteChore(id: string) {
  if (!(await getHouseholdId())) return;
  await getDb().delete(chores).where(eq(chores.id, id));
  updateTag(CACHE_TAGS.chores);
}
