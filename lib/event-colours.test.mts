import { test } from "node:test";
import assert from "node:assert/strict";
import { EVENT_COLOURS, eventColourHex, isEventColour } from "./event-colours.ts";

test("isEventColour accepts every name in the palette", () => {
  for (const { name } of EVENT_COLOURS) {
    assert.equal(isEventColour(name), true);
  }
});

test("isEventColour rejects an unknown name", () => {
  assert.equal(isEventColour("chartreuse"), false);
});

test("isEventColour rejects null and undefined", () => {
  assert.equal(isEventColour(null), false);
  assert.equal(isEventColour(undefined), false);
});

test("eventColourHex returns the matching hex for a known name", () => {
  assert.equal(eventColourHex("tomato"), "#e5484d");
});

test("eventColourHex returns undefined for an unknown name", () => {
  assert.equal(eventColourHex("chartreuse"), undefined);
});

test("eventColourHex returns undefined for null and undefined", () => {
  assert.equal(eventColourHex(null), undefined);
  assert.equal(eventColourHex(undefined), undefined);
});
