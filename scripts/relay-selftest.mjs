#!/usr/bin/env node
// Tự kiểm relay đọc một lần, thuần Node (≥18, dùng fetch có sẵn). KHÔNG in nội dung blob hay biến môi trường.
// Chạy khi server đang sống:  BASE=http://localhost:3000 RELAY_MASTER_KEY=... node scripts/relay-selftest.mjs
// Có một bước ngủ 61 giây để chờ cửa 60 giây đóng. Thoát 0 khi mọi kịch bản đạt.
import crypto from "node:crypto";

const BASE = (process.env.BASE || "http://localhost:3000").replace(/\/+$/, "");
const MASTER = process.env.RELAY_MASTER_KEY;
if (!MASTER) {
  console.error("Cần RELAY_MASTER_KEY trong môi trường (giá trị không bao giờ được in).");
  process.exit(1);
}

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`ok   ${name}`);
  else {
    failures += 1;
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function put(body, master = MASTER, extra = {}) {
  return fetch(`${BASE}/put`, {
    method: "POST",
    headers: { "x-relay-master": master, "content-type": "application/octet-stream", ...extra },
    body,
  });
}
async function get(key, extra = {}) {
  return fetch(`${BASE}/get/${key}`, { headers: { ...extra } });
}

// 1. put ok → 200, key 64 hex, expiresInSec 900
const blob = crypto.randomBytes(100);
const put1 = await put(blob);
check("put ok → 200", put1.status === 200, `status=${put1.status}`);
const put1json = await put1.json().catch(() => ({}));
const key1 = put1json.key;
check("put trả key 64 hex", /^[0-9a-f]{64}$/.test(String(key1 || "")));
check("put trả expiresInSec=900", put1json.expiresInSec === 900);
check("put trả readUrl đúng khóa", String(put1json.readUrl || "").endsWith(`/get/${key1}`));

// 2. get lần đầu → 200 cùng byte
const g1 = await get(key1);
const g1body = Buffer.from(await g1.arrayBuffer());
check("get lần đầu → 200", g1.status === 200, `status=${g1.status}`);
check("get lần đầu cùng byte", g1body.equals(blob), `len=${g1body.length}`);

// 3. get lại trong cửa 60 giây → vẫn 200
const g2 = await get(key1);
const g2body = Buffer.from(await g2.arrayBuffer());
check("get lại trong cửa → 200", g2.status === 200, `status=${g2.status}`);
check("get lại cùng byte", g2body.equals(blob), `len=${g2body.length}`);

// 4. HEAD trên khóa mới không đóng dấu read_at
const putH = await put(crypto.randomBytes(16));
const keyH = (await putH.json().catch(() => ({}))).key;
const h = await fetch(`${BASE}/get/${keyH}`, { method: "HEAD" });
check("HEAD khóa mới → 200", h.status === 200, `status=${h.status}`);
check(
  "HEAD không đóng dấu (không x-relay-read-at, dies-in ≈ 900)",
  !h.headers.get("x-relay-read-at") && Number(h.headers.get("x-relay-dies-in")) > 850,
  `dies-in=${h.headers.get("x-relay-dies-in")}`,
);
const gH = await get(keyH);
check("get sau HEAD vẫn 200 đầy đủ", gH.status === 200);

// 5. sai master → 401
const bad = await put("x", "sai-rob-bien");
check("put sai master → 401", bad.status === 401, `status=${bad.status}`);

// 6. quá hạn mức 4194305 byte → 413
const big = new Uint8Array(4194305);
const o = await put(big);
check("put 4194305 byte → 413", o.status === 413, `status=${o.status}`);

// 7. khóa 64 hex lạ → 404
const u = await get(crypto.randomBytes(32).toString("hex"));
check("khóa lạ 64 hex → 404", u.status === 404, `status=${u.status}`);

// 7b. key không đúng 64 hex → 404
const z = await fetch(`${BASE}/get/zzz`);
check("key zzz → 404", z.status === 404, `status=${z.status}`);

// 7c. Range bytes=0-9 → 206 với 10 byte
const putR = await put(Buffer.from("0123456789" + "a".repeat(90)));
const keyR = (await putR.json().catch(() => ({}))).key;
const r = await get(keyR, { range: "bytes=0-9" });
const rbody = Buffer.from(await r.arrayBuffer());
check("range bytes=0-9 → 206", r.status === 206, `status=${r.status}`);
check("range trả đúng Content-Range", r.headers.get("content-range") === "bytes 0-9/100", r.headers.get("content-range"));
check("range trả 10 byte", rbody.length === 10, `len=${rbody.length}`);

// 8. ngủ 61 giây: khóa key1 (đọc lần đầu ở bước 2) phải chết → 410, nội dung bị xóa
console.log("ngủ 61 giây chờ cửa đóng...");
await new Promise((resolve) => setTimeout(resolve, 61_000));
const dead = await get(key1);
check("sau 61 giây key1 → 410", dead.status === 410, `status=${dead.status}`);
const deadAgain = await get(key1);
check("410 lặp lại ổn định", deadAgain.status === 410, `status=${deadAgain.status}`);

console.log(failures ? `FAILURES: ${failures}` : "ALL OK");
process.exit(failures ? 1 : 0);
