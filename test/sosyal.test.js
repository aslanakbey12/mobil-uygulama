import { test } from "node:test";
import assert from "node:assert/strict";
import { sosyalYolMu } from "../src/sosyal.js";

test("uykudaki sosyal yollar kapanır", () => {
  for (const u of ["/rooms/ai", "/rooms/create", "/friends", "/friends/request", "/dm/thread?withUserId=x", "/matchmaking/status?userId=1", "/report", "/token", "/voiceroom/clip/5", "/league/sync", "/block", "/chat/recap", "/ws"])
    assert.equal(sosyalYolMu(u), true, u);
});

test("öğrenme uçları ve sosyal olmayanlar açık kalır", () => {
  for (const u of ["/reading/report", "/ai/report", "/word/example", "/me/activity", "/me/entitlement", "/profile/username-check?u=a", "/push/register", "/health", "/account/delete", "/coach/weekly", "/reportx", "/roomsx"])
    assert.equal(sosyalYolMu(u), false, u);
});
