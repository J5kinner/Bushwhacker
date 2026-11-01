/**
 * Upkeep chore decay calculations, urgency grouping, and turn-taking logic.
 *
 * Models chore freshness on an interval decay scale inspired by Tody and Sweepy.
 * Chores decay towards renewal based on elapsed time since last completed (or created).
 * Household turn-taking rotates automatically between the two household partners.
 */

export type ChoreUrgency = "overdue" | "due-soon" | "up-to-date" | "one-off";

export interface ChoreDecayInput {
  intervalDays: number | null;
  lastCompletedAt: Date | string | null;
  createdAt: Date | string;
}

export interface ChoreDecayResult {
  urgency: ChoreUrgency;
  ratio: number;
  percentage: number;
  daysRemaining: number | null;
  daysOverdue: number | null;
  label: string;
  dueDate: Date | null;
}

const MS_PER_DAY = 86_400_000;

/**
 * Calculates decay ratio, urgency bracket, and human-readable timing labels
 * for a chore against a target date (defaulting to the current device instant).
 */
export function calculateChoreDecay(
  chore: ChoreDecayInput,
  now: Date = new Date(),
): ChoreDecayResult {
  if (chore.intervalDays === null || chore.intervalDays <= 0) {
    return {
      urgency: "one-off",
      ratio: 0,
      percentage: 0,
      daysRemaining: null,
      daysOverdue: null,
      label: chore.lastCompletedAt ? "Completed" : "One-off",
      dueDate: null,
    };
  }

  const anchor = chore.lastCompletedAt
    ? new Date(chore.lastCompletedAt)
    : new Date(chore.createdAt);

  const anchorMs = anchor.getTime();
  const nowMs = now.getTime();
  const intervalMs = chore.intervalDays * MS_PER_DAY;
  const dueDate = new Date(anchorMs + intervalMs);

  const elapsedMs = Math.max(0, nowMs - anchorMs);
  const elapsedDays = elapsedMs / MS_PER_DAY;
  const ratio = elapsedDays / chore.intervalDays;
  const percentage = Math.min(100, Math.max(0, Math.round(ratio * 100)));

  if (ratio >= 1.0) {
    const overdueDays = Math.max(1, Math.ceil((nowMs - dueDate.getTime()) / MS_PER_DAY));
    const label = overdueDays === 1 ? "1 day overdue" : `${overdueDays} days overdue`;

    return {
      urgency: "overdue",
      ratio,
      percentage: 100,
      daysRemaining: 0,
      daysOverdue: overdueDays,
      label,
      dueDate,
    };
  }

  const remainingDays = Math.max(0, Math.ceil((dueDate.getTime() - nowMs) / MS_PER_DAY));
  let label: string;
  if (remainingDays === 0) {
    label = "Due today";
  } else if (remainingDays === 1) {
    label = "Due tomorrow";
  } else {
    label = `Due in ${remainingDays} days`;
  }

  const urgency: ChoreUrgency = ratio >= 0.7 ? "due-soon" : "up-to-date";

  return {
    urgency,
    ratio,
    percentage,
    daysRemaining: remainingDays,
    daysOverdue: null,
    label,
    dueDate,
  };
}

export interface HouseholdMemberInfo {
  id: string;
  name: string;
}

export interface NextTurnResult {
  memberId: string | null;
  name: string;
  isCurrentUser: boolean;
  label: string;
}

/**
 * Derives whose turn it is next to complete the chore.
 *
 * For a two-person household:
 * - If last completed by partner A, next turn is partner B.
 * - If last completed by partner B, next turn is partner A.
 * - If never completed yet, defaults to the chore's thinking owner.
 * - Single-member household gracefully falls back to that lone member.
 */
export function getNextTurn(
  chore: { ownerId: string; lastCompletedById: string | null },
  members: HouseholdMemberInfo[],
  currentUserId?: string | null,
): NextTurnResult {
  if (members.length === 0) {
    return {
      memberId: null,
      name: "Someone",
      isCurrentUser: false,
      label: "Turn: Someone",
    };
  }

  let nextMember: HouseholdMemberInfo;

  if (members.length === 1) {
    nextMember = members[0];
  } else if (chore.lastCompletedById) {
    const otherMember = members.find((m) => m.id !== chore.lastCompletedById);
    nextMember = otherMember ?? members.find((m) => m.id === chore.ownerId) ?? members[0];
  } else {
    const ownerMember = members.find((m) => m.id === chore.ownerId);
    nextMember = ownerMember ?? members[0];
  }

  const isCurrentUser = Boolean(currentUserId && nextMember.id === currentUserId);
  const label = isCurrentUser ? "Your turn" : `Turn: ${nextMember.name}`;

  return {
    memberId: nextMember.id,
    name: nextMember.name,
    isCurrentUser,
    label,
  };
}

export interface GroupedChores<T> {
  overdue: T[];
  dueSoon: T[];
  upToDate: T[];
  oneOff: T[];
}

/**
 * Groups chores into urgency categories, sorted by most urgent first.
 */
export function groupChoresByUrgency<T extends ChoreDecayInput>(
  choresList: T[],
  now: Date = new Date(),
): GroupedChores<T> {
  const overdue: { item: T; ratio: number }[] = [];
  const dueSoon: { item: T; ratio: number }[] = [];
  const upToDate: { item: T; ratio: number }[] = [];
  const oneOff: T[] = [];

  for (const chore of choresList) {
    const decay = calculateChoreDecay(chore, now);
    switch (decay.urgency) {
      case "overdue":
        overdue.push({ item: chore, ratio: decay.ratio });
        break;
      case "due-soon":
        dueSoon.push({ item: chore, ratio: decay.ratio });
        break;
      case "up-to-date":
        upToDate.push({ item: chore, ratio: decay.ratio });
        break;
      case "one-off":
        oneOff.push(chore);
        break;
    }
  }

  // Sort within urgency bands: highest decay ratio first
  overdue.sort((a, b) => b.ratio - a.ratio);
  dueSoon.sort((a, b) => b.ratio - a.ratio);
  upToDate.sort((a, b) => b.ratio - a.ratio);

  return {
    overdue: overdue.map((e) => e.item),
    dueSoon: dueSoon.map((e) => e.item),
    upToDate: upToDate.map((e) => e.item),
    oneOff,
  };
}

