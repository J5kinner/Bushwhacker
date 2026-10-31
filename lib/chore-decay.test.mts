import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calculateChoreDecay,
  getNextTurn,
  groupChoresByUrgency,
  type ChoreDecayInput,
  type HouseholdMemberInfo,
} from "./chore-decay.ts";

test("calculateChoreDecay: one-off chore without interval", () => {
  const chore: ChoreDecayInput = {
    intervalDays: null,
    lastCompletedAt: null,
    createdAt: new Date("2026-10-01T10:00:00Z"),
  };
  const now = new Date("2026-10-15T10:00:00Z");
  const result = calculateChoreDecay(chore, now);

  assert.equal(result.urgency, "one-off");
  assert.equal(result.ratio, 0);
  assert.equal(result.percentage, 0);
  assert.equal(result.daysRemaining, null);
  assert.equal(result.daysOverdue, null);
  assert.equal(result.label, "One-off");
  assert.equal(result.dueDate, null);
});

test("calculateChoreDecay: one-off chore that was completed", () => {
  const chore: ChoreDecayInput = {
    intervalDays: null,
    lastCompletedAt: new Date("2026-10-05T10:00:00Z"),
    createdAt: new Date("2026-10-01T10:00:00Z"),
  };
  const now = new Date("2026-10-15T10:00:00Z");
  const result = calculateChoreDecay(chore, now);

  assert.equal(result.urgency, "one-off");
  assert.equal(result.label, "Completed");
});

test("calculateChoreDecay: up-to-date chore (ratio < 0.7)", () => {
  const chore: ChoreDecayInput = {
    intervalDays: 7,
    lastCompletedAt: new Date("2026-10-10T00:00:00Z"),
    createdAt: new Date("2026-10-01T00:00:00Z"),
  };
  // 2 days elapsed out of 7 => ratio = 2/7 ~= 0.286 (< 0.7)
  const now = new Date("2026-10-12T00:00:00Z");
  const result = calculateChoreDecay(chore, now);

  assert.equal(result.urgency, "up-to-date");
  assert.equal(result.percentage, 29);
  assert.equal(result.daysRemaining, 5);
  assert.equal(result.daysOverdue, null);
  assert.equal(result.label, "Due in 5 days");
  assert.ok(result.dueDate);
});

test("calculateChoreDecay: due soon chore (0.7 <= ratio < 1.0)", () => {
  const chore: ChoreDecayInput = {
    intervalDays: 10,
    lastCompletedAt: new Date("2026-10-01T00:00:00Z"),
    createdAt: new Date("2026-10-01T00:00:00Z"),
  };
  // 8 days elapsed out of 10 => ratio = 0.8
  const now = new Date("2026-10-09T00:00:00Z");
  const result = calculateChoreDecay(chore, now);

  assert.equal(result.urgency, "due-soon");
  assert.equal(result.percentage, 80);
  assert.equal(result.daysRemaining, 2);
  assert.equal(result.daysOverdue, null);
  assert.equal(result.label, "Due in 2 days");
});

test("calculateChoreDecay: due tomorrow label", () => {
  const chore: ChoreDecayInput = {
    intervalDays: 5,
    lastCompletedAt: new Date("2026-10-01T00:00:00Z"),
    createdAt: new Date("2026-10-01T00:00:00Z"),
  };
  // 4.2 days elapsed out of 5 => remaining is ceil(0.8) = 1
  const now = new Date("2026-10-05T04:48:00Z");
  const result = calculateChoreDecay(chore, now);

  assert.equal(result.urgency, "due-soon");
  assert.equal(result.daysRemaining, 1);
  assert.equal(result.label, "Due tomorrow");
});

test("calculateChoreDecay: overdue chore (ratio >= 1.0)", () => {
  const chore: ChoreDecayInput = {
    intervalDays: 7,
    lastCompletedAt: new Date("2026-10-01T00:00:00Z"),
    createdAt: new Date("2026-10-01T00:00:00Z"),
  };
  // 10 days elapsed out of 7 => 3 days overdue
  const now = new Date("2026-10-11T00:00:00Z");
  const result = calculateChoreDecay(chore, now);

  assert.equal(result.urgency, "overdue");
  assert.equal(result.percentage, 100);
  assert.equal(result.daysRemaining, 0);
  assert.equal(result.daysOverdue, 3);
  assert.equal(result.label, "3 days overdue");
});

test("calculateChoreDecay: 1 day overdue singular label", () => {
  const chore: ChoreDecayInput = {
    intervalDays: 7,
    lastCompletedAt: new Date("2026-10-01T00:00:00Z"),
    createdAt: new Date("2026-10-01T00:00:00Z"),
  };
  // 7.5 days elapsed out of 7 => 0.5 days past due => ceil is 1
  const now = new Date("2026-10-08T12:00:00Z");
  const result = calculateChoreDecay(chore, now);

  assert.equal(result.urgency, "overdue");
  assert.equal(result.daysOverdue, 1);
  assert.equal(result.label, "1 day overdue");
});

test("calculateChoreDecay: anchors from createdAt when never completed", () => {
  const chore: ChoreDecayInput = {
    intervalDays: 14,
    lastCompletedAt: null,
    createdAt: new Date("2026-10-01T00:00:00Z"),
  };
  // 20 days elapsed from creation => overdue
  const now = new Date("2026-10-21T00:00:00Z");
  const result = calculateChoreDecay(chore, now);

  assert.equal(result.urgency, "overdue");
  assert.equal(result.daysOverdue, 6);
});

test("getNextTurn: alternates between household members", () => {
  const members: HouseholdMemberInfo[] = [
    { id: "user-1", name: "Jonah" },
    { id: "user-2", name: "Sarah" },
  ];

  // User 1 completed it last -> next turn is User 2
  const turnAfterUser1 = getNextTurn(
    { ownerId: "user-1", lastCompletedById: "user-1" },
    members,
    "user-2",
  );
  assert.equal(turnAfterUser1.memberId, "user-2");
  assert.equal(turnAfterUser1.name, "Sarah");
  assert.equal(turnAfterUser1.isCurrentUser, true);
  assert.equal(turnAfterUser1.label, "Your turn");

  // User 2 completed it last -> next turn is User 1
  const turnAfterUser2 = getNextTurn(
    { ownerId: "user-1", lastCompletedById: "user-2" },
    members,
    "user-2",
  );
  assert.equal(turnAfterUser2.memberId, "user-1");
  assert.equal(turnAfterUser2.name, "Jonah");
  assert.equal(turnAfterUser2.isCurrentUser, false);
  assert.equal(turnAfterUser2.label, "Turn: Jonah");
});

test("getNextTurn: defaults to owner when never completed", () => {
  const members: HouseholdMemberInfo[] = [
    { id: "user-1", name: "Jonah" },
    { id: "user-2", name: "Sarah" },
  ];

  const initialTurn = getNextTurn(
    { ownerId: "user-2", lastCompletedById: null },
    members,
    "user-1",
  );
  assert.equal(initialTurn.memberId, "user-2");
  assert.equal(initialTurn.name, "Sarah");
  assert.equal(initialTurn.isCurrentUser, false);
  assert.equal(initialTurn.label, "Turn: Sarah");
});

test("getNextTurn: handles single-member household", () => {
  const members: HouseholdMemberInfo[] = [{ id: "user-1", name: "Jonah" }];

  const turn = getNextTurn(
    { ownerId: "user-1", lastCompletedById: "user-1" },
    members,
    "user-1",
  );
  assert.equal(turn.memberId, "user-1");
  assert.equal(turn.name, "Jonah");
  assert.equal(turn.isCurrentUser, true);
  assert.equal(turn.label, "Your turn");
});

test("groupChoresByUrgency: categorises and sorts chores correctly", () => {
  const now = new Date("2026-10-15T00:00:00Z");

  const c1: ChoreDecayInput & { id: string } = {
    id: "overdue-1",
    intervalDays: 7,
    lastCompletedAt: new Date("2026-10-01T00:00:00Z"), // 14 days elapsed, ratio = 2.0
    createdAt: new Date("2026-10-01T00:00:00Z"),
  };
  const c2: ChoreDecayInput & { id: string } = {
    id: "overdue-2",
    intervalDays: 7,
    lastCompletedAt: new Date("2026-10-07T00:00:00Z"), // 8 days elapsed, ratio = 1.14
    createdAt: new Date("2026-10-01T00:00:00Z"),
  };
  const c3: ChoreDecayInput & { id: string } = {
    id: "due-soon-1",
    intervalDays: 10,
    lastCompletedAt: new Date("2026-10-07T00:00:00Z"), // 8 days elapsed, ratio = 0.8
    createdAt: new Date("2026-10-01T00:00:00Z"),
  };
  const c4: ChoreDecayInput & { id: string } = {
    id: "up-to-date-1",
    intervalDays: 14,
    lastCompletedAt: new Date("2026-10-14T00:00:00Z"), // 1 day elapsed, ratio = 0.07
    createdAt: new Date("2026-10-01T00:00:00Z"),
  };
  const c5: ChoreDecayInput & { id: string } = {
    id: "one-off-1",
    intervalDays: null,
    lastCompletedAt: null,
    createdAt: new Date("2026-10-01T00:00:00Z"),
  };

  const grouped = groupChoresByUrgency([c4, c2, c5, c1, c3], now);

  assert.equal(grouped.overdue.length, 2);
  // c1 ratio (2.0) should be before c2 ratio (1.14)
  assert.equal(grouped.overdue[0].id, "overdue-1");
  assert.equal(grouped.overdue[1].id, "overdue-2");

  assert.equal(grouped.dueSoon.length, 1);
  assert.equal(grouped.dueSoon[0].id, "due-soon-1");

  assert.equal(grouped.upToDate.length, 1);
  assert.equal(grouped.upToDate[0].id, "up-to-date-1");

  assert.equal(grouped.oneOff.length, 1);
  assert.equal(grouped.oneOff[0].id, "one-off-1");
});

