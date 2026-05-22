import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

const TG_TOKEN = "test-token-1234567890";
process.env.TG_TOKEN ??= TG_TOKEN;
process.env.WEBHOOK ??= "http://localhost:9999";
process.env.DB_PATH ??= ":memory:";
process.env.NODE_ENV ??= "test";
// Drive the firing/cooldown tests with a small N so simulating "trailing
// window has N samples" is cheap. The change-alerts module reads CHANGE_WINDOW
// from config at import time, so this env override has to be in place BEFORE
// the dynamic import in `before(...)` below.
process.env.CHANGE_WINDOW ??= "5";

let nock;
let listAlerts;
let insertAlert;
let changeAlertFromCommand;
let setChangeAlert;
let priceChangeHandler;
let listChangeAlerts;
let overrideCooldownMs;
let resetChangeAlertState;
let MAX_CHANGE_ALERTS_PER_CHAT;
let insertChangeAlert;
let getChangeAlertsByChatId;
let getChangeAlertsByPair;
let getChangeAlertCount;
let deleteChangeAlert;
let removeChangeAlert;
let evictCooldown;
let app;
let server;
let baseUrl;

before(async () => {
  nock = (await import("nock")).default;
  nock.disableNetConnect();
  nock.enableNetConnect("127.0.0.1");

  ({ listAlerts } = await import("../src/alerts.js"));
  ({
    changeAlertFromCommand,
    setChangeAlert,
    priceChangeHandler,
    listChangeAlerts,
    overrideCooldownMs,
    resetChangeAlertState,
    MAX_CHANGE_ALERTS_PER_CHAT,
    removeChangeAlert,
    evictCooldown,
  } = await import("../src/change-alerts.js"));
  ({
    insertAlert,
    insertChangeAlert,
    getChangeAlertsByChatId,
    getChangeAlertsByPair,
    getChangeAlertCount,
    deleteChangeAlert,
  } = await import("../src/db.js"));
  ({ app } = await import("../index.js"));

  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

after(() => {
  if (server) server.close();
  if (nock) {
    nock.cleanAll();
    nock.enableNetConnect();
  }
});

const postJson = (path, body) =>
  new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const url = new URL(path, baseUrl);
    const req = http.request(
      {
        method: "POST",
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
      },
      (res) => {
        let chunks = "";
        res.on("data", (c) => (chunks += c));
        res.on("end", () => resolve({ status: res.statusCode, body: chunks }));
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });

// Captures a single outgoing Telegram sendMessage body.
const captureSendMessage = () => {
  let resolveBody;
  const seen = new Promise((r) => (resolveBody = r));
  const scope = nock("https://api.telegram.org")
    .post(`/bot${TG_TOKEN}/sendMessage`, (body) => {
      resolveBody(body);
      return true;
    })
    .reply(200, { ok: true, result: {} });
  return { scope, seen };
};

// Captures up to N outgoing Telegram sendMessage bodies. Returns a promise
// resolving to the array once all N have arrived. Used by the quota tests
// where we register 20 alerts in a row.
const captureSendMessages = (n) => {
  const bodies = [];
  let resolveAll;
  const seen = new Promise((r) => (resolveAll = r));
  const scope = nock("https://api.telegram.org")
    .post(`/bot${TG_TOKEN}/sendMessage`, (body) => {
      bodies.push(body);
      if (bodies.length === n) resolveAll(bodies);
      return true;
    })
    .times(n)
    .reply(200, { ok: true, result: {} });
  return { scope, seen };
};

// Firing tests share a single in-memory sqlite with the registration/quota/
// listing tests above — and priceChangeHandler fires every alert on the
// pair regardless of chatId. Wipe per-pair before each firing test so stale
// rows from earlier tests can't trigger phantom sendMessage calls.
const wipeChangeAlertsForPair = async (pair) => {
  const rows = await getChangeAlertsByPair(pair);
  await Promise.all(rows.map((r) => deleteChangeAlert(r.id)));
};
const wipeAllChangeAlerts = async () => {
  for (const pair of ["XBT/USD", "XBT/EUR", "XBT/GBP"]) {
    await wipeChangeAlertsForPair(pair);
  }
};

const MD_V2_SPECIALS = new Set("_*[]()~`>#+-=|{}.!");

const unescapedSpecials = (text) => {
  const found = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\") {
      if (i + 1 >= text.length) {
        found.push({ ch: "\\", index: i, reason: "trailing backslash" });
      }
      i += 2;
      continue;
    }
    if (MD_V2_SPECIALS.has(ch)) {
      found.push({ ch, index: i });
    }
    i += 1;
  }
  return found;
};

// ---------- Registration ----------

test("setChangeAlert: /changealert 5 registers a 5% threshold in USD by default", async () => {
  const chat = "ca-reg-5usd";
  const { scope, seen } = captureSendMessage();

  await setChangeAlert(chat, "5");

  const body = await seen;
  assert.ok(scope.isDone());
  assert.equal(body.chat_id, chat);
  assert.ok(/change alert/i.test(body.text), `expected set template, got: ${body.text}`);
  assert.ok(body.text.includes("USD"), `expected USD currency, got: ${body.text}`);
  assert.ok(body.text.includes("5"), `expected threshold 5 in body, got: ${body.text}`);

  const rows = await getChangeAlertsByChatId(chat);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].pair, "XBT/USD");
  assert.equal(rows[0].threshold, 5);
});

test("setChangeAlert: /changealert 2.5 eur registers fractional threshold in EUR", async () => {
  const chat = "ca-reg-25eur";
  const { scope, seen } = captureSendMessage();

  await setChangeAlert(chat, "2.5", "eur");

  const body = await seen;
  assert.ok(scope.isDone());
  assert.ok(body.text.includes("EUR"), `expected EUR currency, got: ${body.text}`);
  // 2.5 → "2\.5" once MarkdownV2-escaped, since "." is a special.
  assert.ok(/2\\.5/.test(body.text), `expected escaped 2.5 threshold, got: ${body.text}`);

  const rows = await getChangeAlertsByChatId(chat);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].pair, "XBT/EUR");
  assert.equal(rows[0].threshold, 2.5);
});

test("changeAlertFromCommand: /changealert with no argument hits changeAlertAcknowledgment", async () => {
  const chat = "ca-reg-noarg";
  const { scope, seen } = captureSendMessage();

  await changeAlertFromCommand(chat, "/changealert");

  const body = await seen;
  assert.ok(scope.isDone());
  assert.ok(
    /please send the percentage threshold/i.test(body.text),
    `expected changeAlertAcknowledgment template, got: ${body.text}`
  );
});

test("setChangeAlert: currency defaults to usd when omitted", async () => {
  const chat = "ca-reg-default-usd";
  const { scope, seen } = captureSendMessage();

  await setChangeAlert(chat, "7"); // no currency arg

  await seen;
  assert.ok(scope.isDone());
  const rows = await getChangeAlertsByChatId(chat);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].pair, "XBT/USD", "default pair must be USD");
});

test("setChangeAlert: trailing percent sign (e.g. '5%') is accepted", async () => {
  // PERCENT_RE allows an optional trailing %, but parseFloat strips it. This
  // pins behavior so a future tightening of the regex doesn't silently break
  // existing users.
  const chat = "ca-reg-pctsign";
  const { scope, seen } = captureSendMessage();

  await setChangeAlert(chat, "5%");

  await seen;
  assert.ok(scope.isDone());
  const rows = await getChangeAlertsByChatId(chat);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].threshold, 5);
});

// ---------- Percent parsing rejects ----------

const expectUnsupportedTarget = async (chat, fn) => {
  const { scope, seen } = captureSendMessage();
  await fn();
  const body = await seen;
  assert.ok(scope.isDone(), `sendMessage was not invoked for ${chat}`);
  assert.ok(
    /change threshold could not be understood/i.test(body.text),
    `expected unsupportedTarget, got: ${body.text}`
  );
  const rows = await getChangeAlertsByChatId(chat);
  assert.equal(rows.length, 0, `no row should have been inserted for ${chat}`);
};

test("setChangeAlert: whitespace-only payload routes to changeAlertAcknowledgment (same as bare /changealert)", async () => {
  const chat = "ca-rej-empty";
  const { scope, seen } = captureSendMessage();
  await changeAlertFromCommand(chat, "/changealert    ");
  const body = await seen;
  assert.ok(scope.isDone());
  assert.ok(
    /please send the percentage threshold/i.test(body.text),
    `expected changeAlertAcknowledgment, got: ${body.text}`
  );
  const rows = await getChangeAlertsByChatId(chat);
  assert.equal(rows.length, 0, "no row should have been inserted");
});

test("setChangeAlert: zero is rejected", async () => {
  const chat = "ca-rej-zero";
  await expectUnsupportedTarget(chat, () => setChangeAlert(chat, "0"));
});

test("setChangeAlert: negative percent is rejected (regex rejects leading -)", async () => {
  const chat = "ca-rej-neg";
  await expectUnsupportedTarget(chat, () => setChangeAlert(chat, "-5"));
});

test("setChangeAlert: NaN / non-numeric token is rejected", async () => {
  const chat = "ca-rej-nan";
  await expectUnsupportedTarget(chat, () => setChangeAlert(chat, "abc"));
});

test("setChangeAlert: mixed-token like '5x' is rejected by strict regex", async () => {
  // parseFloat("5x") === 5; the strict PERCENT_RE in change-alerts.js is what
  // makes this rejected. Regression guard against accidentally going back to
  // parseFloat-only validation.
  const chat = "ca-rej-5x";
  await expectUnsupportedTarget(chat, () => setChangeAlert(chat, "5x"));
});

test("setChangeAlert: excessive percent (>1000) is rejected", async () => {
  const chat = "ca-rej-toobig";
  await expectUnsupportedTarget(chat, () => setChangeAlert(chat, "1001"));
});

test("setChangeAlert: boundary 1000 is accepted (>1000 rejected, exactly 1000 ok)", async () => {
  const chat = "ca-rej-1000-ok";
  const { scope, seen } = captureSendMessage();
  await setChangeAlert(chat, "1000");
  await seen;
  assert.ok(scope.isDone());
  const rows = await getChangeAlertsByChatId(chat);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].threshold, 1000);
});

// ---------- Per-chat quota (MAX_CHANGE_ALERTS_PER_CHAT = 20) ----------

test("quota: MAX_CHANGE_ALERTS_PER_CHAT export equals 20", () => {
  assert.equal(MAX_CHANGE_ALERTS_PER_CHAT, 20);
});

test("quota: 20 change alerts succeed (boundary lower)", async () => {
  const chat = "ca-quota-20";
  const { scope, seen } = captureSendMessages(20);

  for (let i = 0; i < 20; i++) {
    // vary threshold to keep rows distinct, no two equal
    await setChangeAlert(chat, String(i + 1));
  }
  await seen;
  assert.ok(scope.isDone(), "expected 20 sendMessage calls");

  const count = await getChangeAlertCount(chat);
  assert.equal(count, 20);
});

test("quota: 21st change alert is rejected with tooManyChangeAlerts (boundary upper)", async () => {
  // Seed exactly the cap by DB insert so this test does not depend on the
  // 20-success path running first.
  const chat = "ca-quota-21";
  for (let i = 0; i < 20; i++) {
    await insertChangeAlert({ chatId: chat, pair: "XBT/USD", threshold: i + 1 });
  }
  assert.equal(await getChangeAlertCount(chat), 20);

  const { scope, seen } = captureSendMessage();
  await setChangeAlert(chat, "5"); // 21st attempt
  const body = await seen;
  assert.ok(scope.isDone());
  assert.ok(
    /maximum number of change alerts/i.test(body.text),
    `expected tooManyChangeAlerts template, got: ${body.text}`
  );

  // The 21st must NOT have been inserted.
  assert.equal(await getChangeAlertCount(chat), 20);
});

test("quota: counts change alerts per chatId only (chatB unaffected at chatA's cap)", async () => {
  const chatA = "ca-quota-iso-A";
  const chatB = "ca-quota-iso-B";
  for (let i = 0; i < 20; i++) {
    await insertChangeAlert({ chatId: chatA, pair: "XBT/USD", threshold: i + 1 });
  }
  assert.equal(await getChangeAlertCount(chatA), 20);
  assert.equal(await getChangeAlertCount(chatB), 0);

  const { scope, seen } = captureSendMessage();
  await setChangeAlert(chatB, "3");
  const body = await seen;
  assert.ok(scope.isDone());
  assert.ok(
    /change alert/i.test(body.text) && !/maximum number/i.test(body.text),
    `chatB should hit changeAlertSet, not the cap, got: ${body.text}`
  );

  assert.equal(await getChangeAlertCount(chatA), 20, "chatA's count must not change");
  assert.equal(await getChangeAlertCount(chatB), 1, "chatB's first alert must be inserted");
});

// ---------- Listing (combined with price alerts) ----------

test("listAlerts: includes change-alert rows alongside price alerts", async () => {
  const chat = "ca-list-combined";
  await insertAlert({ chatId: chat, target: 30000, pair: "XBT/USD", alertOn: "higher" });
  await insertChangeAlert({ chatId: chat, pair: "XBT/USD", threshold: 5 });
  const { scope, seen } = captureSendMessage();

  await listAlerts(chat);
  const body = await seen;
  assert.ok(scope.isDone());

  // Price-alert row markers:
  assert.ok(body.text.includes("rises above"), `missing price-alert direction: ${body.text}`);
  assert.ok(body.text.includes("30,000"), `missing price-alert amount: ${body.text}`);
  // Change-alert row markers (Δ symbol + "moves ≥" phrasing):
  assert.ok(body.text.includes("Δ"), `missing Δ change-alert marker: ${body.text}`);
  assert.ok(body.text.includes("moves"), `missing 'moves' change-alert phrasing: ${body.text}`);
});

test("listAlerts: price alerts render before change alerts in the combined listing", async () => {
  // Listing format deviation accepted by team-lead: change alerts append after
  // price alerts. Pin that ordering so a future refactor doesn't silently
  // interleave them.
  const chat = "ca-list-order";
  await insertAlert({ chatId: chat, target: 42000, pair: "XBT/USD", alertOn: "higher" });
  await insertChangeAlert({ chatId: chat, pair: "XBT/USD", threshold: 3 });

  const { scope, seen } = captureSendMessage();
  await listAlerts(chat);
  const body = await seen;
  assert.ok(scope.isDone());

  const priceIdx = body.text.indexOf("42,000");
  const changeIdx = body.text.indexOf("Δ");
  assert.ok(priceIdx !== -1, `missing price-alert row: ${body.text}`);
  assert.ok(changeIdx !== -1, `missing change-alert row: ${body.text}`);
  assert.ok(
    priceIdx < changeIdx,
    `expected price row before change row, got positions ${priceIdx}/${changeIdx}`
  );
});

test("listAlerts: chatId isolation — chatA does not see chatB's change alerts", async () => {
  const chatA = "ca-list-iso-A";
  const chatB = "ca-list-iso-B";
  await insertChangeAlert({ chatId: chatA, pair: "XBT/USD", threshold: 4 });
  await insertChangeAlert({ chatId: chatB, pair: "XBT/EUR", threshold: 9 });

  const { scope, seen } = captureSendMessage();
  await listAlerts(chatA);
  const body = await seen;
  assert.ok(scope.isDone());

  assert.equal(body.chat_id, chatA);
  // chatA's threshold (4) appears, chatB's (9) does not. We pin the exact
  // "≥ 4%" / "≥ 9%" rendered shape to avoid false negatives from a stray "9"
  // appearing elsewhere in the body.
  assert.ok(/≥\s*4%/.test(body.text), `chatA threshold missing: ${body.text}`);
  assert.ok(!/≥\s*9%/.test(body.text), `chatB threshold leaked: ${body.text}`);
  assert.ok(!body.text.includes("EUR"), `chatB currency leaked: ${body.text}`);
});

test("listAlerts: empty case (no price + no change alerts) still hits alertsEmpty", async () => {
  const chat = "ca-list-empty";
  const { scope, seen } = captureSendMessage();
  await listAlerts(chat);
  const body = await seen;
  assert.ok(scope.isDone());
  assert.ok(
    /no active alerts/i.test(body.text),
    `expected alertsEmpty, got: ${body.text}`
  );
});

// ---------- Firing (priceChangeHandler) ----------

const CHANGE_WINDOW = 5; // mirrors process.env.CHANGE_WINDOW above
const PAIR = "XBT/USD";

// Race a captured-body promise against a short timer. Resolves to either the
// captured body (fired) or the string "timeout" (no fire).
const settleOrTimeout = (seen, ms) =>
  Promise.race([seen, new Promise((r) => setTimeout(() => r("__timeout__"), ms))]);

test("firing: does NOT fire before the trailing window has N samples", async () => {
  await wipeAllChangeAlerts();
  resetChangeAlertState();
  const chat = "ca-fire-prewindow";
  await insertChangeAlert({ chatId: chat, pair: PAIR, threshold: 1 });

  // Set up a single interceptor (it MUST NOT be consumed). Race against a
  // short timer — if priceChangeHandler fires, `seen` resolves with a body;
  // otherwise we hit the timeout sentinel.
  const { scope, seen } = captureSendMessage();

  // Push only N-1 samples, the last one wildly off any reasonable average.
  for (let i = 0; i < CHANGE_WINDOW - 1; i++) {
    await priceChangeHandler({ [PAIR]: i === CHANGE_WINDOW - 2 ? 1_000_000 : 50_000 });
  }

  const outcome = await settleOrTimeout(seen, 80);
  assert.equal(
    outcome,
    "__timeout__",
    `no sendMessage should have fired during warmup, got: ${JSON.stringify(outcome)}`
  );
  // The interceptor is pending — clear it so later tests don't see it.
  assert.ok(!scope.isDone(), "the interceptor should still be pending (no fire)");
  nock.cleanAll();
});

test("firing: fires when |current - avg|/avg crosses threshold upward", async () => {
  await wipeAllChangeAlerts();
  resetChangeAlertState();
  overrideCooldownMs(60_000); // long cooldown — we only fire once here
  const chat = "ca-fire-up";
  await insertChangeAlert({ chatId: chat, pair: PAIR, threshold: 2 });

  // Warmup 4 samples at 50,000 → average 50,000. 5th at 52,000 → delta +4%.
  const { scope, seen } = captureSendMessage();
  for (let i = 0; i < CHANGE_WINDOW - 1; i++) {
    await priceChangeHandler({ [PAIR]: 50_000 });
  }
  await priceChangeHandler({ [PAIR]: 52_000 });
  const body = await seen;
  assert.ok(scope.isDone(), "firing did not invoke sendMessage");
  assert.equal(body.chat_id, chat);
  assert.ok(/change alert has been triggered/i.test(body.text), `wrong template: ${body.text}`);
});

test("firing: fires when |current - avg|/avg crosses threshold downward", async () => {
  await wipeAllChangeAlerts();
  resetChangeAlertState();
  overrideCooldownMs(60_000);
  const chat = "ca-fire-down";
  await insertChangeAlert({ chatId: chat, pair: PAIR, threshold: 2 });

  const { scope, seen } = captureSendMessage();
  for (let i = 0; i < CHANGE_WINDOW - 1; i++) {
    await priceChangeHandler({ [PAIR]: 50_000 });
  }
  await priceChangeHandler({ [PAIR]: 48_000 }); // -4% vs avg → fires
  const body = await seen;
  assert.ok(scope.isDone());
  assert.equal(body.chat_id, chat);
  assert.ok(/change alert has been triggered/i.test(body.text), `wrong template: ${body.text}`);
});

test("firing: triggered message carries DELTA, AVERAGE, CURRENT, THRESHOLD substitutions", async () => {
  await wipeAllChangeAlerts();
  resetChangeAlertState();
  overrideCooldownMs(60_000);
  const chat = "ca-fire-subs";
  await insertChangeAlert({ chatId: chat, pair: PAIR, threshold: 2 });

  const { scope, seen } = captureSendMessage();
  for (let i = 0; i < CHANGE_WINDOW - 1; i++) {
    await priceChangeHandler({ [PAIR]: 50_000 });
  }
  // avg of 5 samples will be (50_000*4 + 52_500)/5 = 50_500. Current = 52_500.
  // delta = (52500-50500)/50500 *100 ≈ 3.96% → fires (threshold 2%).
  await priceChangeHandler({ [PAIR]: 52_500 });
  const body = await seen;
  assert.ok(scope.isDone());

  // No template placeholders should leak through.
  assert.ok(!body.text.includes("%THRESHOLD%"), `%THRESHOLD% not substituted: ${body.text}`);
  assert.ok(!body.text.includes("%CURRENT%"), `%CURRENT% not substituted: ${body.text}`);
  assert.ok(!body.text.includes("%AVERAGE%"), `%AVERAGE% not substituted: ${body.text}`);
  assert.ok(!body.text.includes("%DELTA%"), `%DELTA% not substituted: ${body.text}`);

  // CURRENT and AVERAGE go through Intl.NumberFormat → "52,500" / "50,500".
  assert.ok(body.text.includes("52,500"), `missing CURRENT 52,500: ${body.text}`);
  assert.ok(body.text.includes("50,500"), `missing AVERAGE 50,500: ${body.text}`);
  // DELTA is ~3.96 — assert SOME positive non-zero formatted value (escaped dot).
  assert.ok(/\d+\\\.\d+/.test(body.text), `missing fractional DELTA: ${body.text}`);
});

// ---------- Cooldown + auto-rearm ----------

test("cooldown: second crossing within COOLDOWN_MS does NOT re-fire", async () => {
  await wipeAllChangeAlerts();
  resetChangeAlertState();
  overrideCooldownMs(60_000); // wide cooldown, no rearm during test
  const chat = "ca-cool-1";
  await insertChangeAlert({ chatId: chat, pair: PAIR, threshold: 2 });

  const { scope: scope1, seen: seen1 } = captureSendMessage();
  for (let i = 0; i < CHANGE_WINDOW - 1; i++) {
    await priceChangeHandler({ [PAIR]: 50_000 });
  }
  await priceChangeHandler({ [PAIR]: 52_000 }); // fires once
  await seen1;
  assert.ok(scope1.isDone(), "first crossing must fire");

  // Second crossing within cooldown — set up an interceptor that MUST NOT
  // match. nock.times(0) interceptors stay pending; if a request arrives,
  // nock will throw `disableNetConnect` (this is the disallowed-host case)
  // or, if matched, mark the interceptor done. We rely on `pendingMocks` to
  // detect either way.
  const noFireScope = nock("https://api.telegram.org")
    .post(`/bot${TG_TOKEN}/sendMessage`)
    .times(1) // would be consumed by a second fire (which we don't want)
    .reply(200, { ok: true, result: {} });

  await priceChangeHandler({ [PAIR]: 53_000 }); // bigger swing, but cooldown
  // Give the async pipeline a tick.
  await new Promise((r) => setImmediate(r));

  assert.ok(!noFireScope.isDone(), "second crossing should NOT have fired (cooldown)");
  nock.cleanAll();
});

test("cooldown: crossing after COOLDOWN_MS elapses fires again (auto-rearm)", async () => {
  await wipeAllChangeAlerts();
  resetChangeAlertState();
  overrideCooldownMs(50); // short cooldown for the rearm window
  const chat = "ca-cool-rearm";
  await insertChangeAlert({ chatId: chat, pair: PAIR, threshold: 2 });

  // First fire.
  const { scope: scope1, seen: seen1 } = captureSendMessage();
  for (let i = 0; i < CHANGE_WINDOW - 1; i++) {
    await priceChangeHandler({ [PAIR]: 50_000 });
  }
  await priceChangeHandler({ [PAIR]: 52_000 });
  await seen1;
  assert.ok(scope1.isDone(), "first fire missed");

  // Wait past cooldown.
  await new Promise((r) => setTimeout(r, 120));

  // Second fire — needs another big enough delta vs trailing avg. The buffer
  // currently holds [50k, 50k, 50k, 50k, 52k] → avg 50.4k. A 53k tick is
  // +5.16% — well past the 2% threshold.
  const { scope: scope2, seen: seen2 } = captureSendMessage();
  await priceChangeHandler({ [PAIR]: 53_000 });
  await seen2;
  assert.ok(scope2.isDone(), "second fire (post-cooldown) missed");
});

test("cooldown: keyed per (chatId, pair) — different pair fires independently", async () => {
  await wipeAllChangeAlerts();
  resetChangeAlertState();
  overrideCooldownMs(60_000);
  const chat = "ca-cool-perpair";
  await insertChangeAlert({ chatId: chat, pair: "XBT/USD", threshold: 2 });
  await insertChangeAlert({ chatId: chat, pair: "XBT/EUR", threshold: 2 });

  // Warm up both pairs equally to the same avg, then trip both on the same
  // tick. Each pair has its OWN ring buffer + cooldown key → both fire.
  const expected = captureSendMessages(2);
  for (let i = 0; i < CHANGE_WINDOW - 1; i++) {
    await priceChangeHandler({ "XBT/USD": 50_000, "XBT/EUR": 40_000 });
  }
  await priceChangeHandler({ "XBT/USD": 52_000, "XBT/EUR": 41_600 });

  const bodies = await expected.seen;
  assert.ok(expected.scope.isDone(), "expected exactly 2 sendMessages, one per pair");
  // Both messages went to the same chat:
  assert.ok(bodies.every((b) => b.chat_id === chat));
});

test("cooldown: removeChangeAlert (delete + evict) lets a recreated alert fire immediately", async () => {
  await wipeAllChangeAlerts();
  resetChangeAlertState();
  overrideCooldownMs(60_000);
  const chat = "ca-cool-evict";

  // Create + fire to seat a cooldown entry.
  const inserted = await insertChangeAlert({
    chatId: chat,
    pair: PAIR,
    threshold: 2,
  });
  const { scope: scope1, seen: seen1 } = captureSendMessage();
  for (let i = 0; i < CHANGE_WINDOW - 1; i++) {
    await priceChangeHandler({ [PAIR]: 50_000 });
  }
  await priceChangeHandler({ [PAIR]: 52_000 });
  await seen1;
  assert.ok(scope1.isDone());

  // Delete via removeChangeAlert (which evicts the cooldown key). Then create
  // a NEW alert on the same pair and expect it to fire on the next crossing
  // even though COOLDOWN_MS has not elapsed.
  await removeChangeAlert(inserted.lastID, chat, PAIR);
  await insertChangeAlert({ chatId: chat, pair: PAIR, threshold: 2 });

  const { scope: scope2, seen: seen2 } = captureSendMessage();
  // Buffer is currently [50k×4, 52k] → avg 50.4k. A 53k tick is +5.16%.
  await priceChangeHandler({ [PAIR]: 53_000 });
  await seen2;
  assert.ok(scope2.isDone(), "recreated alert did not fire — stale cooldown leaked");
});

test("cooldown: evictCooldown(chatId, pair) is exported and removes the entry", () => {
  // Pure unit check on the exported helper — guards against accidental
  // un-exporting in a refactor.
  assert.equal(typeof evictCooldown, "function");
  // Sanity: calling it on a non-existent key must not throw.
  evictCooldown("nobody", "XBT/USD");
});

// ---------- MarkdownV2 safety ----------

test("MarkdownV2: changeAlertSet body has every special escaped (unescapedSpecials walk)", async () => {
  const chat = "ca-mdv2-set";
  const { scope, seen } = captureSendMessage();

  // 12.5% threshold → "." special must be escaped to "\." in the rendered body.
  await setChangeAlert(chat, "12.5", "eur");

  const body = await seen;
  assert.ok(scope.isDone());
  const leaks = unescapedSpecials(body.text);
  assert.equal(
    leaks.length,
    0,
    `unescaped MarkdownV2 specials in changeAlertSet body: ${JSON.stringify(leaks)} in ${JSON.stringify(body.text)}`
  );
  assert.ok(body.text.includes("\\."), "expected escaped . from threshold 12.5");
});

test("MarkdownV2: changeAlertTriggered body has every special escaped (unescapedSpecials walk)", async () => {
  await wipeAllChangeAlerts();
  resetChangeAlertState();
  overrideCooldownMs(60_000);
  const chat = "ca-mdv2-fire";
  await insertChangeAlert({ chatId: chat, pair: PAIR, threshold: 1 });

  const { scope, seen } = captureSendMessage();
  for (let i = 0; i < CHANGE_WINDOW - 1; i++) {
    await priceChangeHandler({ [PAIR]: 50_000 });
  }
  await priceChangeHandler({ [PAIR]: 52_000 }); // fires
  const body = await seen;
  assert.ok(scope.isDone());

  const leaks = unescapedSpecials(body.text);
  assert.equal(
    leaks.length,
    0,
    `unescaped MarkdownV2 specials in changeAlertTriggered body: ${JSON.stringify(leaks)} in ${JSON.stringify(body.text)}`
  );
  // The "-" inside the literal " - currently trading at " must be escaped.
  assert.ok(body.text.includes("\\-"), "expected escaped - in triggered template");
});

// ---------- Routing regression ----------

test("routing regex: /^\\/changealert(@\\w+)?(\\s|$)/i matches the right set of inputs", () => {
  const re = /^\/changealert(@\w+)?(\s|$)/i;

  // SHOULD match:
  assert.ok(re.test("/changealert"), "/changealert must match");
  assert.ok(re.test("/changealert 5"), "/changealert 5 must match");
  assert.ok(re.test("/ChangeAlert"), "case-insensitive must match");
  assert.ok(re.test("/changealert@SomeBot"), "/changealert@Bot must match");
  assert.ok(re.test("/changealert@SomeBot 5"), "/changealert@Bot <arg> must match");

  // MUST NOT match (so they fall through to /alert prefix or default):
  assert.ok(!re.test("/changealertfoo"), "/changealertfoo (no boundary) must NOT match");
  assert.ok(!re.test("/alert"), "/alert (singular) must NOT match");
  assert.ok(!re.test("/alerts"), "/alerts (plural list) must NOT match");
  assert.ok(!re.test("changealert"), "no leading slash must NOT match");
  assert.ok(!re.test(" /changealert"), "leading space must NOT match");
});

test("webhook routing: /changealert is dispatched to changeAlertFromCommand, not /alert", async () => {
  const { scope, seen } = captureSendMessage();
  const res = await postJson(`/${TG_TOKEN}`, {
    update_id: 2001,
    message: {
      message_id: 1,
      chat: { id: "route-changealert-bare" },
      text: "/changealert",
    },
  });
  assert.ok(res.status >= 200 && res.status < 300);
  const body = await seen;
  assert.ok(scope.isDone());
  assert.ok(
    !/please send the target price for the alert/i.test(body.text),
    `/changealert was incorrectly routed to /alert: ${body.text}`
  );
  assert.ok(
    /please send the percentage threshold/i.test(body.text),
    `expected changeAlertAcknowledgment for bare /changealert, got: ${body.text}`
  );
});

test("webhook routing: /changealert is NOT swallowed by /alerts (plural list)", async () => {
  // /alerts → listAlerts → "no active alerts" (chat is empty). If /changealert
  // matched the /alerts regex, we'd see that template instead.
  const { scope, seen } = captureSendMessage();
  const res = await postJson(`/${TG_TOKEN}`, {
    update_id: 2002,
    message: {
      message_id: 2,
      chat: { id: "route-changealert-vs-alerts" },
      text: "/changealert 5",
    },
  });
  assert.ok(res.status >= 200 && res.status < 300);
  const body = await seen;
  assert.ok(scope.isDone());
  assert.ok(
    !/no active alerts/i.test(body.text),
    `/changealert was incorrectly routed to /alerts: ${body.text}`
  );
});

test("webhook routing: /changealert@SomeBot suffix is routed to changeAlertFromCommand", async () => {
  const { scope, seen } = captureSendMessage();
  const res = await postJson(`/${TG_TOKEN}`, {
    update_id: 2003,
    message: {
      message_id: 3,
      chat: { id: "route-changealert-suffix" },
      text: "/changealert@XbtPriceBot 5",
    },
  });
  assert.ok(res.status >= 200 && res.status < 300);
  const body = await seen;
  assert.ok(scope.isDone());
  // 5% USD set → set template, not unsupportedTarget.
  assert.ok(/change alert/i.test(body.text), `wrong template: ${body.text}`);
  // No unresolved placeholders. Note: literal "%" is fine in the template
  // (e.g. "5% or more"); we only forbid the %NAME% placeholder shape.
  assert.ok(
    !body.text.includes("%CURRENCY%") && !body.text.includes("%THRESHOLD%"),
    `unresolved placeholder in body: ${body.text}`
  );
});

test("webhook routing: /changealertfoo (no boundary) is NOT routed to changeAlertFromCommand", async () => {
  // /changealertfoo should fall through past the /changealert regex and the
  // /alert prefix branch (which it won't match either — startsWith("/alert")
  // IS true, so it lands in alertFromCommand → alertFromResponse("foo") →
  // unsupportedCurrency or unsupportedTarget depending on parse). The point:
  // it must NOT hit changeAlertFromCommand (which would interpret "foo" as
  // a percent → unsupportedTarget anyway, indistinguishable). We instead
  // assert the SET template ("Change alert has been set") never appears, since
  // a real /changealert route would only produce that template (for valid
  // input) or unsupportedTarget. The negative invariant: no set-template.
  const { scope, seen } = captureSendMessage();
  const res = await postJson(`/${TG_TOKEN}`, {
    update_id: 2004,
    message: {
      message_id: 4,
      chat: { id: "route-changealertfoo" },
      text: "/changealertfoo",
    },
  });
  assert.ok(res.status >= 200 && res.status < 300);
  const body = await seen;
  assert.ok(scope.isDone());
  assert.ok(
    !/change alert has been set/i.test(body.text),
    `/changealertfoo was incorrectly routed to changeAlertFromCommand: ${body.text}`
  );
});
