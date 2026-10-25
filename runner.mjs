const SITE_URL = (process.env.SITE_URL || "https://ashare-ai-lab-live-eprgkbyuuam.qoder.zone").replace(/\/+$/, "");
const ORIGIN = new URL(SITE_URL).origin;
const TOKEN = process.env.CRON_TOKEN || "";
const FORCE_TICK = process.env.FORCE_TICK === "1";
const REPLAY_ONLY = process.env.REPLAY_ONLY === "1";
const REPLAY_MS = Number(process.env.REPLAY_MS || 40 * 60 * 1000);
const TICK_MS = 10_000;
const START_MINUTE = 9 * 60 + 20;
const END_MINUTE = 15 * 60 + 5;

if (!TOKEN) {
  console.error("missing CRON_TOKEN");
  process.exitCode = 1;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function bjt(date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hour12: false,
    }).formatToParts(date).map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minute: Number(parts.hour) * 60 + Number(parts.minute),
    weekday: parts.weekday,
  };
}

async function post(action, body = {}, timeoutMs = 25_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${SITE_URL}/functions/v1/app?action=${action}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: ORIGIN,
        referer: `${ORIGIN}/`,
        "x-ashare-cron": TOKEN,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text.slice(0, 200) };
    }
    if (!response.ok) {
      throw new Error(`${action}_${response.status}_${payload.error || "request_failed"}`);
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

async function waitForSession() {
  while (true) {
    const now = bjt(new Date());
    if (now.weekday === "Sat" || now.weekday === "Sun") {
      console.log("weekend, exit");
      return false;
    }
    if (now.minute < START_MINUTE) {
      console.log("waiting for pre-open window");
      await sleep(60_000);
      continue;
    }
    if (now.minute > END_MINUTE) {
      console.log("session already over, exit");
      return false;
    }
    return true;
  }
}

async function drainReplay(budgetMs = REPLAY_MS) {
  const startedAt = Date.now();
  let errors = 0;
  while (Date.now() - startedAt < budgetMs) {
    let result;
    try {
      result = await post("ai-replay-advance", {}, 150_000);
      errors = 0;
    } catch (error) {
      errors += 1;
      console.error(new Date().toISOString(), "replay error", error.message);
      if (errors >= 5) return;
      await sleep(20_000);
      continue;
    }
    const job = result.job || {};
    console.log(new Date().toISOString(), "replay", result.status,
      `${job.cursor || 0}/${job.dates?.length || 0}`, job.waiting || "");
    if (!result.active || result.status === "budget_wait") return;
    if (result.status === "locked") await sleep(15_000);
  }
}

async function main() {
  if (!TOKEN) return;
  if (REPLAY_ONLY) {
    await drainReplay();
    return;
  }
  if (FORCE_TICK) {
    const result = await post("tick", {}, 30_000);
    console.log("force tick", JSON.stringify(result));
    const status = await post("ai-replay-advance", {}, 150_000).catch(() => null);
    if (status?.active) {
      console.log("replay active, draining");
      await drainReplay();
    }
    return;
  }

  const ready = await waitForSession();
  if (!ready) return;

  let lastReviewDate = "";
  let decisionInFlight = false;
  let replayInFlight = false;

  const kickReplay = () => {
    if (replayInFlight) return;
    replayInFlight = true;
    post("ai-replay-advance", {}, 150_000)
      .then((result) => {
        if (result.status === "idle") return;
        console.log("replay", result.status, result.job?.cursor, result.job?.waiting || "");
      })
      .catch((error) => console.error("replay failed", error.message))
      .finally(() => { replayInFlight = false; });
  };

  while (true) {
    const now = bjt(new Date());
    if (now.weekday === "Sat" || now.weekday === "Sun" || now.minute > END_MINUTE) break;
    if (now.minute < START_MINUTE) {
      await sleep(30_000);
      continue;
    }

    try {
      const tick = await post("tick", {}, 30_000);
      console.log(new Date().toISOString(), "tick", tick.marketState,
        tick.decisionDue ? "decision_due" : "",
        tick.reviewDue ? "review_due" : "");

      if (tick.reviewDue && lastReviewDate !== now.date) {
        lastReviewDate = now.date;
        const review = await post("review", { kind: "daily" }, 180_000);
        console.log("review", review?.report?.status, review?.report?.summary);
      }

      if (tick.decisionDue && !decisionInFlight) {
        decisionInFlight = true;
        post("decide", { source: "cron" }, 180_000)
          .then((result) => console.log("decision", result.status, result.actions))
          .catch((error) => console.error("decision failed", error.message))
          .finally(() => { decisionInFlight = false; });
      }

      kickReplay();
    } catch (error) {
      console.error(new Date().toISOString(), "heartbeat error", error.message);
    }

    await sleep(TICK_MS);
  }

  console.log("session finished");
  await drainReplay(20 * 60 * 1000);
}

main().catch((error) => {
  console.error("runner failed", error.message);
  process.exitCode = 1;
});
