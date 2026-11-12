/* Site Test Logger — phone app (offline PWA). Data stays on the phone until exported. */
"use strict";

const DEFAULTS = {
  engineer: "", projectName: "", discipline: "Mechanical", reportTitle: "T&C Test Witness Report", purgeDays: 2,
  syncUrl: "", syncKey: "", autoSync: false,
  projects: ["Mataf Extension", "HUP", "Piazza", "HSVB", "HEB"],
  systems: ["Chilled Water Pump", "Air Handling Unit (AHU)", "Fan Coil Unit (FCU)", "Fire Hose Cabinet (FHC)", "Ventilation Fans",
    "Pressure Reducing Stations (Service Water)", "Deluge Valve", "Submersible Pump", "Water Mist System", "Movable Skylight System"],
  activities: ["Pre-commissioning and Start-up", "Pre-commissioning and Commissioning", "Pre-commissioning, Startup & TAB air side",
    "TAB Air Side", "Air Balancing", "Pressure Test", "Flushing", "Functional Test"],
  issues: ["Leakage", "Pressure drop", "Vibration / Noise", "Wrong rotation", "Insulation", "Labeling / Tagging", "Supports / Hangers",
    "Incomplete installation", "Damaged component", "Electrical / Control not ready", "Readings out of range", "Access / Clearance",
    "Documents missing", "Cleanliness", "Other"],
  // Photo checklist per equipment type. First line whose keyword appears in the System name wins.
  // Format:  keyword | keyword = shot; shot; shot
  checklists: [
    "submersible = Pump nameplate; Control panel; Level / float switches; Discharge valves & check valve; Guide rail & lifting chain; Running readings (A / pressure)",
    "fan coil | fcu = Unit nameplate; General view; Drain pan & condensate line; Filter; Valves & actuator; Thermostat",
    "air handling | ahu = AHU nameplate; Fan motor nameplate; General view; Filters; Coil & drain pan; Fan / belt alignment; Dampers & actuators; DDC control panel; Running readings (airflow / ΔP / A)",
    "pump = Pump nameplate; Motor nameplate; General view; Pressure gauges (suction / discharge); Valves & strainer; Flex connectors / isolators; Control panel / VFD; Running readings (A / pressure)",
    "fan = Fan nameplate; Motor nameplate; General view; Flex connectors / isolators; Dampers; Isolator / control panel; Running readings (A / airflow)",
    "fire hose | fhc = Cabinet general view; Hose reel & hose; Landing valve; Pressure gauge reading; Nozzle; Signage & glass",
    "deluge = Valve set general view; Trim & pressure gauges; Solenoid valve; Pressure / alarm switch; Signage",
    "pressure reducing | prs = General view; PRV nameplate; Upstream / downstream gauges; Strainer; Bypass & isolation valves",
    "water mist | mist = Control panel; Pump unit nameplate; Nozzles; Pressure gauges; Signage",
    "skylight = General view; Motor / actuator nameplate; Control panel; Open position; Closed position",
    "* = Nameplate; General view; Running readings",
  ].join("\n"),
};
const FORM = "__form"; // old test-level form photos (kept for compatibility)
const FORM_SHOT = "Site test form"; // form pages are now stored inside each tag with this shot name
const isFormP = (p) => p.tagId === FORM || p.shot === FORM_SHOT;

function shotsFor(system) {
  const sys = String(system || "").toLowerCase();
  for (const line of String(S.checklists || "").split(/\n/)) {
    const [k, v] = line.split("=");
    if (!v) continue;
    const keys = k.split("|").map((x) => x.trim().toLowerCase()).filter(Boolean);
    if (keys.some((key) => key === "*" || sys.includes(key))) return v.split(";").map((x) => x.trim()).filter(Boolean);
  }
  return [];
}
/* "P-1FM-A (Serving AHU-1FM-A3)" x2 -> "P-1FM-A-1 (Serving …)", "P-1FM-A-2 (Serving …)" */
function expandTag(tag, n) {
  if (!(n > 1)) return [tag];
  const m = tag.match(/^(\S+)(.*)$/);
  return Array.from({ length: n }, (_, i) => `${m[1]}-${i + 1}${m[2]}`);
}
/* Remember a test's photo list as the default for that exact system name.
   Learned lines go to the top of Settings → Photo checklists, so they win next time. */
async function learnChecklist(t) {
  const sys = String(t.system || "").trim();
  const shots = (t.shots || []).map((x) => x.trim()).filter(Boolean);
  if (!sys || !shots.length) return false;
  const key = sys.toLowerCase().replace(/[|=;\n]/g, " ").trim();
  if (shotsFor(sys).join(";") === shots.join(";")) return false; // already the default
  const lines = String(S.checklists || "").split(/\n/).filter((l) => {
    const k = l.split("=")[0];
    return !(l.includes("=") && k.split("|").map((x) => x.trim().toLowerCase()).length === 1 && k.trim().toLowerCase() === key);
  });
  S.checklists = [`${key} = ${shots.join("; ")}`, ...lines].join("\n");
  await kvSet("settings", S);
  return true;
}

function nextShot(t, tagId) {
  const have = new Set(t.photos.filter((p) => p.tagId === tagId).map((p) => p.shot));
  return (t.shots || []).find((s) => !have.has(s)) || "";
}

/* ---------------- IndexedDB ---------------- */
let DB;
function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open("site-test-logger", 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      db.createObjectStore("tests", { keyPath: "id" });
      db.createObjectStore("photos");
      db.createObjectStore("kv");
    };
    r.onsuccess = () => res((DB = r.result));
    r.onerror = () => rej(r.error);
  });
}
function tx(store, mode, fn) {
  return new Promise((res, rej) => {
    const t = DB.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    Promise.resolve(fn(s)).then((v) => (out = v));
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
  });
}
const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const dbAllTests = () => tx("tests", "readonly", (s) => req(s.getAll()));
const dbPutTest = (t) => tx("tests", "readwrite", (s) => s.put(t));
const dbDelTest = (id) => tx("tests", "readwrite", (s) => s.delete(id));
const dbPutPhoto = (id, blob) => tx("photos", "readwrite", (s) => s.put(blob, id));
const dbGetPhoto = (id) => tx("photos", "readonly", (s) => req(s.get(id)));
const dbDelPhoto = (id) => tx("photos", "readwrite", (s) => s.delete(id));
const kvGet = (k) => tx("kv", "readonly", (s) => req(s.get(k)));
const kvSet = (k, v) => tx("kv", "readwrite", (s) => s.put(v, k));

/* ---------------- State ---------------- */
let S = { ...DEFAULTS };
let TESTS = [];
const urls = new Map(); // photo id -> object URL
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const opts = (list, cur) => [...new Set([...(list || []), cur].filter(Boolean))].map((v) => `<option value="${esc(v)}"${v === cur ? " selected" : ""}>${esc(v)}</option>`).join("");
const dlist = (id, list) => `<datalist id="${id}">${(list || []).map((v) => `<option value="${esc(v)}">`).join("")}</datalist>`;

function toast(msg, ms = 2600) {
  const d = document.createElement("div");
  d.className = "toast"; d.textContent = msg; document.body.appendChild(d);
  setTimeout(() => d.remove(), ms);
}
function statusClass(s) { return String(s).startsWith("Partial") ? "Partial" : s; }
function hasWork(t) { return t.photos.length > 0 || t.tags.some((g) => g.status || g.remark); }
function needsExport(t) { return !t.photosPurged && hasWork(t) && (!t.exportedAt || (t.updatedAt || 0) > t.exportedAt); }
async function save(t) { t.updatedAt = Date.now(); await dbPutTest(t); scheduleSync(90000); }
async function photoURL(id) {
  if (urls.has(id)) return urls.get(id);
  const b = await dbGetPhoto(id);
  if (!b) return null;
  const u = URL.createObjectURL(b); urls.set(id, u); return u;
}

/* ---------------- Image capture ---------------- */
function compress(file, max = 1600, q = 0.82) {
  return new Promise((res, rej) => {
    const img = new Image();
    const u = URL.createObjectURL(file);
    img.onload = () => {
      let { width: w, height: h } = img;
      const k = Math.min(1, max / Math.max(w, h));
      w = Math.round(w * k); h = Math.round(h * k);
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(u);
      c.toBlob((b) => (b ? res({ blob: b, w, h }) : rej(new Error("compress failed"))), "image/jpeg", q);
    };
    img.onerror = () => { URL.revokeObjectURL(u); rej(new Error("Cannot read image")); };
    img.src = u;
  });
}
let captureTarget = null; // { testId, tagId, shot }
// mode: "cam" = camera straight away, "lib" = photo library (multi-select), "any" = iPhone asks Take Photo / Photo Library
function capture(testId, tagId, mode, shot) {
  captureTarget = { testId, tagId, shot: shot || "" };
  if (mode === "any") {
    // our own choice sheet: Android's photo picker hides the camera, and some phones show nothing at all
    const bg = sheet(`<b>${esc(shot || "Add photo")}</b><div class="row" style="margin-top:12px;gap:10px">
      <button class="btn" id="cap-cam" style="flex:1;padding:16px">📷 Camera</button>
      <button class="btn ghost" id="cap-lib" style="flex:1;padding:16px">🖼 Gallery</button></div>`);
    bg.querySelector("#cap-cam").onclick = () => { bg.remove(); const i = $("#cam"); i.value = ""; i.click(); };
    bg.querySelector("#cap-lib").onclick = () => { bg.remove(); const i = $("#pick"); i.value = ""; i.click(); };
    return;
  }
  const inp = mode === true || mode === "lib" ? $("#pick") : $("#cam");
  inp.value = ""; inp.click();
}
async function onFiles(e) {
  const files = [...e.target.files];
  if (!files.length || !captureTarget) return;
  const t = TESTS.find((x) => x.id === captureTarget.testId);
  if (!t) return;
  let last;
  const isForm = captureTarget.tagId === FORM || captureTarget.shot === FORM_SHOT;
  for (const f of files) {
    try {
      const { blob, w, h } = await compress(f, isForm ? 2400 : 1600, isForm ? 0.85 : 0.82);
      const id = uid();
      await dbPutPhoto(id, blob);
      const shot = isForm ? FORM_SHOT : (files.length === 1 ? captureTarget.shot : "") || "";
      last = { id, tagId: captureTarget.tagId || "", shot, status: "A", issue: "", comment: "", w, h, at: Date.now() };
      t.photos.push(last);
    } catch (err) { toast("Photo error: " + err.message); }
  }
  await save(t);
  renderTest(t.id, true);
  if (last && files.length === 1 && !isForm) openPhoto(t.id, last.id, true);
}

/* ---------------- Routing ---------------- */
let route = { name: "home" };
function go(r) { route = r; render(); window.scrollTo(0, 0); }
$("#back").onclick = () => {
  if (route.name === "test" && route.edit) go({ name: "test", id: route.id });
  else go({ name: "home" });
};
function setHeader(title, back, right = "") {
  $("#title").textContent = title; $("#back").hidden = !back; $("#hdr-right").innerHTML = right;
}
function render() {
  if (route.name === "home") renderHome();
  else if (route.name === "test") route.edit ? renderEdit(route.id) : renderTest(route.id);
  else if (route.name === "settings") renderSettings();
}

/* ---------------- Home ---------------- */
function renderHome() {
  setHeader("Site Test Logger", false, `<button id="gear">Settings</button>`);
  $("#gear").onclick = () => go({ name: "settings" });
  const pending = TESTS.filter(needsExport).length;
  const byDay = {};
  [...TESTS].sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time)).forEach((t) => (byDay[t.date] ||= []).push(t));
  let h = "";
  if (S.syncUrl && !S.sheetName) {
    h += `<div class="card"><b>Who are you?</b><div class="muted">Pick your name once — the app then downloads your tests every morning.</div>
      ${teamSelect("home-me")}<button class="btn block" id="home-me-ok" style="margin-top:10px">Save</button></div>`;
  }
  if (S.syncUrl) {
    h += `<div class="sync-bar ${SYNC.state}" id="sync-bar">${esc(syncLabel())}</div>`;
    const empty = TESTS.filter((t) => !t.photos.length && !t.exportedAt).length;
    h += `<div class="row" style="margin-bottom:12px"><button class="btn ghost" id="get-plans" style="flex:1">⬇ Get today's tests</button>
      ${IS_DESKTOP ? `<button class="btn ghost" id="send-plans" style="flex:1" ${empty ? "" : "disabled"}>📲 Send ${empty} to phone</button>` : ""}</div>`;
  }
  else if (TESTS.length) h += `<div class="card"><b>Auto-sync is off</b><div class="muted">Add the sync link in Settings so tests go to the laptop by themselves.</div></div>`;
  if (!S.engineer && !(S.syncUrl && !S.sheetName)) h += `<div class="card"><b>First time?</b><div class="muted">Add your name and project in Settings — they go on every report.</div></div>`;
  if (!TESTS.length) h += `<div class="empty">No tests yet.<br>Tap <b>New test</b> when you get today's invitation.</div>`;
  for (const [d, list] of Object.entries(byDay)) {
    const label = new Date(d + "T12:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short", year: "numeric" });
    h += `<div class="day">${d === today() ? "Today · " : ""}${esc(label)}</div>`;
    for (const t of list) {
      const st = Report.testStatus(t);
      const ok = !needsExport(t);
      h += `<button class="card test" data-open="${t.id}">
        <div class="row" style="justify-content:space-between"><span class="t1">${esc(t.system || "Untitled test")}</span><span class="chip ${statusClass(st)}">${esc(st)}</span></div>
        <div class="t2">${esc([t.sr ? "Sr. " + t.sr : "", t.project, t.time].filter(Boolean).join(" · "))}${t.sheetChanged ? ` <span class="chip Partial">sheet changed</span>` : ""}</div>
        <div class="t2">${t.tags.length} tag(s) · ${t.photos.length} photo(s) <span class="synced">${!hasWork(t) && !t.photosPurged ? "· ready to start" : t.photosPurged ? "· photos cleared from phone" : ok ? (S.syncUrl ? "· sent ✓" : "· exported ✓") : S.syncUrl ? "· waiting to sync" : "· not exported"}</span></div>
      </button>`;
    }
  }
  $("#view").innerHTML = h;
  paintSync();
  if ($("#home-me-ok")) $("#home-me-ok").onclick = async () => {
    const v = $("#home-me").value;
    if (!v) return toast("Choose your name");
    applyMember(v); await kvSet("settings", S); toast(`Hi ${S.engineer || S.sheetName} 👋`); renderHome(); getPlans();
  };
  if (S.syncUrl && (!S.team || !S.team.length || Date.now() - (S.teamAt || 0) > 86400000)) loadTeam().then((ch) => { if (ch && route.name === "home") renderHome(); });
  if ($("#get-plans")) $("#get-plans").onclick = getPlans;
  if ($("#send-plans")) $("#send-plans").onclick = sendPlans;
  $("#view").onclick = (e) => { const b = e.target.closest("[data-open]"); if (b) go({ name: "test", id: b.dataset.open }); };
  $("#fab").innerHTML = `<button class="btn ghost" id="exp" ${pending ? "" : "disabled"}>${S.syncUrl ? "Sync now" : "Export"} (${pending})</button><button class="btn" id="new">+ New test</button>`;
  $("#new").onclick = newTest;
  $("#exp").onclick = () => (S.syncUrl ? syncNow(true) : doExport(false));
}

async function newTest() {
  const t = { id: uid(), date: today(), sr: "", project: "", time: "", system: "", activity: "", witness: S.engineer, remarks: "",
    tags: [], photos: [], createdAt: Date.now() };
  TESTS.push(t); await save(t);
  go({ name: "test", id: t.id, edit: true });
}

/* ---------------- Edit test details ---------------- */
function renderEdit(id) {
  const t = TESTS.find((x) => x.id === id); if (!t) return go({ name: "home" });
  setHeader(t.system ? "Edit test" : "New test", true);
  const col = (k) => t.tags.map((g) => g[k] || "").join("\n");
  $("#view").innerHTML = `
  <div class="card">
    <div class="grid2">
      <div><label>Date</label><input type="date" id="f-date" value="${esc(t.date)}"></div>
      <div><label>Time</label><input id="f-time" value="${esc(t.time)}" placeholder="9:00" inputmode="numeric"></div>
    </div>
    <div class="grid2">
      <div><label>Sr. (from invitation)</label><input id="f-sr" value="${esc(t.sr)}" inputmode="numeric"></div>
      <div><label>Project</label><input id="f-project" list="dl-p" value="${esc(t.project)}"></div>
    </div>
    <label>Equipment / System</label><input id="f-system" list="dl-s" value="${esc(t.system)}">
    <label>Activity</label><input id="f-activity" list="dl-a" value="${esc(t.activity)}">
    <label>Witness T&amp;C Engineer</label><input id="f-witness" value="${esc(t.witness)}">
    <label>With me in the test (optional)</label><input id="f-withMe" value="${esc(t.withMe)}" placeholder="e.g. Ahmed Ali, Yasser">
    <label>Location for the summary (optional)</label><input id="f-location" value="${esc(t.location)}" placeholder="Empty = Project - Zone/Floor">
    ${dlist("dl-p", S.projects)}${dlist("dl-s", S.systems)}${dlist("dl-a", S.activities)}
  </div>
  <div class="card">
    <b>Equipment tags</b>
    <div class="hint">One per line, same order in the three boxes. Tip: in WhatsApp, press and hold the text in the invitation photo, Copy, then paste here.</div>
    <label>Equipment Tag Name</label><textarea id="f-tags" rows="4" placeholder="P-1FM-A&#10;P-1FM-E">${esc(col("tag"))}</textarea>
    <div class="grid2">
      <div><label>Qty. (optional)</label><textarea id="f-qty" rows="3" placeholder="2&#10;2" inputmode="numeric"></textarea></div>
      <div><label>Bundle</label><textarea id="f-bundles" rows="3" placeholder="HO-013">${esc(col("bundle"))}</textarea></div>
    </div>
    <label>Zone / Floor</label><textarea id="f-zones" rows="3" placeholder="FM/01-1M-051">${esc(col("zone"))}</textarea>
    <div class="hint">If a box has one line only, it's used for every tag.<br>
      Qty. 2 splits a tag into two units: P-1FM-A → P-1FM-A-1 and P-1FM-A-2. You can rename them after.</div>
  </div>
  <div class="card"><b>Photo checklist</b>
    <div class="hint">Shots needed for each tag. Filled automatically from the system name. If you change it, the new list is remembered for every test of this system.</div>
    <textarea id="f-shots" rows="5">${esc((t.shots && t.shots.length ? t.shots : shotsFor(t.system)).join("\n"))}</textarea>
    <button class="btn ghost" id="f-reshots" style="margin-top:8px">Reset from system name</button>
  </div>
  <div class="card"><label style="margin-top:0">General remarks</label><textarea id="f-remarks">${esc(t.remarks)}</textarea></div>
  <button class="btn danger block" id="del">Delete test</button>`;
  $("#fab").innerHTML = `<button class="btn" id="ok">Save</button>`;
  $("#ok").onclick = async () => {
    const v = (k) => $("#f-" + k).value.trim();
    ["date", "time", "sr", "project", "system", "activity", "witness", "withMe", "location", "remarks"].forEach((k) => (t[k] = v(k)));
    const lines = (k) => v(k).split(/\n/).map((s) => s.trim()).filter(Boolean);
    const rawTags = lines("tags"), rawZones = lines("zones"), rawBundles = lines("bundles"), qty = lines("qty").map((x) => parseInt(x, 10) || 1);
    const pick = (arr, i) => arr.length === 1 ? arr[0] : arr[i] || "";
    const tags = [], zones = [], bundles = [];
    rawTags.forEach((tg, i) => expandTag(tg, pick(qty, i)).forEach((u) => { tags.push(u); zones.push(pick(rawZones, i)); bundles.push(pick(rawBundles, i)); }));
    t.shots = lines("shots");
    if (await learnChecklist(t)) toast(`Photo list saved for every "${t.system}" test`, 2600);
    const old = t.tags;
    const used = new Set();
    t.tags = tags.map((tag, i) => {
      let prev = old[i] && old[i].tag === tag ? old[i] : old.find((g) => g.tag === tag && !used.has(g.id));
      if (!prev && old[i] && !used.has(old[i].id) && !tags.includes(old[i].tag)) prev = old[i];
      if (prev) used.add(prev.id);
      return { id: prev ? prev.id : uid(), tag, zone: zones[i], bundle: bundles[i], status: prev ? prev.status : "", remark: prev ? prev.remark : "" };
    });
    const ids = new Set(t.tags.map((g) => g.id));
    t.photos.forEach((p) => { if (p.tagId && p.tagId !== FORM && !ids.has(p.tagId)) p.tagId = ""; });
    if (!t.tags.length) return toast("Add at least one equipment tag");
    await save(t);
    go({ name: "test", id: t.id });
  };
  $("#f-reshots").onclick = () => { $("#f-shots").value = shotsFor($("#f-system").value).join("\n"); };
  $("#f-system").onchange = () => { if (!$("#f-shots").value.trim() || !(t.shots && t.shots.length)) $("#f-shots").value = shotsFor($("#f-system").value).join("\n"); };
  $("#del").onclick = async () => {
    if (!confirm("Delete this test and its photos from the phone?")) return;
    for (const p of t.photos) await dbDelPhoto(p.id);
    await dbDelTest(t.id); TESTS = TESTS.filter((x) => x.id !== t.id);
    go({ name: "home" });
  };
}

/* ---------------- Test view (tags + photos) ---------------- */
async function renderTest(id, keepScroll) {
  const t = TESTS.find((x) => x.id === id); if (!t) return go({ name: "home" });
  if (!t.shots) { t.shots = shotsFor(t.system); await dbPutTest(t); }
  const y = window.scrollY;
  setHeader(t.system || "Test", true, `<button id="edit">Edit</button>`);
  $("#edit").onclick = () => go({ name: "test", id, edit: true });
  const st = Report.testStatus(t);
  const thumbs = async (tagId) => {
    let h = "";
    for (const p of t.photos.filter((p) => (p.tagId || "") === tagId)) {
      const u = await photoURL(p.id);
      const f = isFormP(p);
      h += `<button class="thumb" data-photo="${p.id}">${u ? `<img src="${u}" alt="">` : `<span class="gone">cleared</span>`}${f ? "" : `<i class="${p.status}"></i>`}${f ? `<span class="cap">📄 Form</span>` : p.shot ? `<span class="cap">${esc(p.shot)}</span>` : ""}</button>`;
    }
    return h + (t.photosPurged ? "" : `<button class="add" data-cam="${tagId}" aria-label="Add photo">+</button>`);
  };
  const checklist = (g) => {
    if (!t.shots.length) return "";
    const ps = t.photos.filter((p) => p.tagId === g.id);
    const done = t.shots.filter((s) => ps.some((p) => p.shot === s)).length;
    return `<div class="shots-h">Photos ${done}/${t.shots.length}</div><div class="shots">${t.shots.map((s) => {
      const p = ps.filter((x) => x.shot === s);
      const cls = !p.length ? "" : p.some((x) => x.status === "R") ? "R" : p.some((x) => x.status === "C") ? "C" : "A";
      return `<button class="shot ${cls ? "done " + cls : ""}" data-shot="${esc(s)}" data-tg="${g.id}" ${t.photosPurged ? "disabled" : ""}>${cls ? "✓ " : ""}${esc(s)}</button>`;
    }).join("")}</div>`;
  };
  const formRow = (g) => {
    const n = t.photos.filter((p) => p.tagId === g.id && p.shot === FORM_SHOT).length;
    return `<div class="shots" style="margin-top:8px"><button class="shot ${n ? "done A" : "form-missing"}" data-shot="${FORM_SHOT}" data-tg="${g.id}" ${t.photosPurged ? "disabled" : ""}>📄 ${n ? `Site test form ✓ ${n} page(s) · add page` : "Site test form — add photo"}</button></div>`;
  };
  const formN = t.photos.filter((p) => p.tagId === FORM).length;
  let h = `<div class="card">
    <div class="row" style="justify-content:space-between"><b>${esc(t.project || "")}</b><span class="chip ${statusClass(st)}">${esc(st)}</span></div>
    <div class="muted">${esc([t.date, t.time, t.sr ? "Sr. " + t.sr : "", t.activity].filter(Boolean).join(" · "))}</div>
    <button class="btn ghost block" id="t-share" style="margin-top:10px">💬 Share summary (WhatsApp)</button>
  </div>`;
  for (const g of t.tags) {
    const s = Report.tagStatus(t, g);
    h += `<div class="card tag s-${s}">
      <div class="row" style="justify-content:space-between"><h3>${esc(g.tag)}</h3><span class="chip ${s}">${s}</span></div>
      <div class="meta">${esc([g.zone, g.bundle].filter(Boolean).join(" · "))}</div>
      <div class="seg" data-tag="${g.id}">
        <button data-st="" class="${!g.status ? "on" : ""}">Auto</button>
        <button data-st="Pass" class="pass ${g.status === "Pass" ? "on" : ""}">Pass</button>
        <button data-st="Fail" class="fail ${g.status === "Fail" ? "on" : ""}">Fail</button>
      </div>
      <input class="remark" data-tag="${g.id}" value="${esc(g.remark)}" placeholder="Remark for this tag (optional)" style="margin-top:8px">
      ${checklist(g)}
      ${formRow(g)}
      <div class="thumbs">${await thumbs(g.id)}</div>
    </div>`;
  }
  if (formN) h += `<div class="card"><b>Site test form (whole test)</b> <span class="chip Pass">${formN} page(s)</span>
    <div class="thumbs">${await thumbs(FORM)}</div></div>`;
  h += `<div class="card"><b>General photos</b><div class="hint">Not linked to a specific tag.</div><div class="thumbs">${await thumbs("")}</div></div>`;
  if (S.syncUrl && !t.photosPurged) h += needsExport(t)
    ? `<button class="btn block" id="t-sync" style="margin:4px 0 14px;padding:15px;background:var(--pass)">✓ Finished — sync this test</button>`
    : `<div class="sync-bar" style="text-align:center">☁︎ Sent ✓${t.exportedAt ? " · " + new Date(t.exportedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}. On the laptop within 5 min. Any later change needs another sync.</div>`;
  if (t.photosPurged) h += `<div class="muted" style="text-align:center">Photos were cleared from the phone ${S.purgeDays} day(s) after export. They're on the laptop.</div>`;
  $("#view").innerHTML = h;
  if (keepScroll) window.scrollTo(0, y);

  $("#view").onclick = async (e) => {
    if (e.target.id === "t-share") return shareSummary(t);
    if (e.target.id === "t-sync") {
      const miss = t.tags.reduce((n, g) => n + t.shots.filter((s) => !t.photos.some((p) => p.tagId === g.id && p.shot === s)).length, 0);
      const noForm = t.tags.filter((g) => !t.photos.some((p) => p.tagId === g.id && p.shot === FORM_SHOT)).length;
      const warn = [miss ? `${miss} checklist photo(s) missing` : "", noForm ? `${noForm} tag(s) without site test form` : ""].filter(Boolean).join(" and ");
      if (warn && !confirm(`Heads up: ${warn}.\nSync anyway?`)) return;
      e.target.disabled = true; e.target.textContent = "Sending…";
      await syncNow(true, t.id);
      return renderTest(t.id, true);
    }
    const sh = e.target.closest("[data-shot]");
    if (sh) return capture(t.id, sh.dataset.tg, "any", sh.dataset.shot);
    const cam = e.target.closest("[data-cam]");
    if (cam) return capture(t.id, cam.dataset.cam, "any", cam.dataset.cam && cam.dataset.cam !== FORM ? nextShot(t, cam.dataset.cam) : "");
    const ph = e.target.closest("[data-photo]");
    if (ph) return openPhoto(t.id, ph.dataset.photo);
    const sb = e.target.closest(".seg button");
    if (sb) {
      const g = t.tags.find((x) => x.id === sb.parentElement.dataset.tag);
      g.status = sb.dataset.st; await save(t); renderTest(t.id, true);
    }
  };
  $("#view").onchange = async (e) => {
    if (e.target.classList.contains("remark")) {
      t.tags.find((x) => x.id === e.target.dataset.tag).remark = e.target.value.trim(); await save(t);
    }
  };
  $("#fab").innerHTML = t.photosPurged ? "" :
    `<button class="btn ghost" id="lib">From library</button><button class="btn" id="shot">📷 Photo</button>`;
  if (!t.photosPurged) {
    const go2 = (tagId, lib) => capture(t.id, tagId, lib, tagId && tagId !== FORM ? nextShot(t, tagId) : "");
    const choose = (lib) => {
      if (!t.tags.length) return go2("", lib);
      pickTag(t, (tagId) => go2(tagId, lib));
    };
    $("#shot").onclick = () => choose(false);
    $("#lib").onclick = () => choose(true);
  }
}

async function shareSummary(t) {
  const text = Report.whatsappText(t, S);
  // photos to pick (forms last); cleared photos are skipped
  const list = [];
  for (const p of [...t.photos].sort((a, b) => isFormP(a) - isFormP(b))) { const u = await photoURL(p.id); if (u) list.push({ p, u }); }
  const tagOf = (p) => { const g = t.tags.find((x) => x.id === p.tagId); return isFormP(p) ? "Form" : g ? g.tag : "General"; };
  const bg = sheet(`<b>Summary</b><textarea id="sum-t" rows="${Math.min(14, text.split("\n").length + 2)}" style="margin-top:10px;font-size:14px">${esc(text)}</textarea>
    <div class="hint">You can edit it before sending.</div>
    ${list.length ? `<div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px"><b>Add photos <span id="sum-n" class="muted"></span></b><button class="btn ghost" id="sum-none" style="padding:4px 10px;font-size:13px">Clear</button></div>
    <div class="thumbs" id="sum-ph">${list.map(({ p, u }) => `<button class="thumb" data-pick="${p.id}" style="outline-offset:-3px"><img src="${u}" alt="" style="width:100%;height:100%;max-height:none;object-fit:cover;border-radius:0">
      <span class="cap">${esc(tagOf(p))}${p.shot && !isFormP(p) ? " · " + esc(p.shot) : ""}</span><b class="ck" style="display:none;position:absolute;top:4px;left:4px;background:#1f9d55;color:#fff;border-radius:50%;width:22px;height:22px;line-height:22px;font-size:13px;text-align:center">✓</b></button>`).join("")}</div>` : ""}
    <div class="row" style="margin-top:12px"><button class="btn ghost" id="sum-copy" style="flex:1">Copy</button><button class="btn" id="sum-wa" style="flex:1;background:#1f9d55">Send to WhatsApp</button></div>`);
  const val = () => bg.querySelector("#sum-t").value;
  const picked = new Set();
  const paint = () => {
    bg.querySelectorAll("[data-pick]").forEach((b) => { const on = picked.has(b.dataset.pick); b.style.outline = on ? "3px solid #1f9d55" : "none"; b.querySelector(".ck").style.display = on ? "block" : "none"; });
    const n = bg.querySelector("#sum-n"); if (n) n.textContent = picked.size ? `(${picked.size} selected)` : "(tap to select)";
  };
  paint();
  bg.querySelectorAll("[data-pick]").forEach((b) => (b.onclick = () => { const id = b.dataset.pick; picked.has(id) ? picked.delete(id) : picked.add(id); paint(); }));
  const none = bg.querySelector("#sum-none"); if (none) none.onclick = () => { picked.clear(); paint(); };
  const copy = async () => {
    try { await navigator.clipboard.writeText(val()); return true; }
    catch { try { bg.querySelector("#sum-t").select(); document.execCommand("copy"); return true; } catch { return false; } }
  };
  bg.querySelector("#sum-copy").onclick = async () => { if (await copy()) toast("Copied ✓"); };
  bg.querySelector("#sum-wa").onclick = async () => {
    if (picked.size) {
      const files = [];
      let i = 0;
      for (const { p } of list) {
        if (!picked.has(p.id)) continue;
        const buf = await getPhotoShare(p.id); if (!buf) continue;
        const name = `${++i}_${tagOf(p)}${p.shot && !isFormP(p) ? "_" + p.shot : ""}`.replace(/[^\w\u0600-\u06FF-]+/g, "_").slice(0, 60) + ".jpg";
        files.push(new File([buf], name, { type: "image/jpeg" }));
      }
      if (!navigator.canShare || !navigator.canShare({ files })) return toast("This phone can't share photos from here — send the text, then attach the photos from WhatsApp", 4500);
      await copy();   // WhatsApp sometimes drops the text when photos are attached -> it's on the clipboard to paste as caption
      try { await navigator.share({ files, text: val() }); toast("If the text is missing, paste it as the caption (it's copied)", 4500); }
      catch (e) { if (e.name !== "AbortError") toast("Couldn't share: " + e.message, 4000); }
      return;
    }
    if (navigator.share) { try { await navigator.share({ text: val() }); return; } catch (e) { if (e.name === "AbortError") return; } }
    location.href = "https://wa.me/?text=" + encodeURIComponent(val());
  };
}
// WhatsApp-size copy of a photo (long side 1600 px)
async function getPhotoShare(id) {
  const b = await dbGetPhoto(id);
  if (!b) return null;
  try {
    const img = await new Promise((res, rej) => { const u = URL.createObjectURL(b); const im = new Image(); im.onload = () => { URL.revokeObjectURL(u); res(im); }; im.onerror = rej; im.src = u; });
    const k = Math.min(1, 1600 / Math.max(img.width, img.height));
    const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return await new Promise((r) => c.toBlob(r, "image/jpeg", 0.82));
  } catch { return b; }
}

function sheet(html) {
  const bg = document.createElement("div");
  bg.className = "sheet-bg"; bg.innerHTML = `<div class="sheet">${html}</div>`;
  bg.onclick = (e) => { if (e.target === bg) bg.remove(); };
  document.body.appendChild(bg);
  return bg;
}
function pickTag(t, cb) {
  const bg = sheet(`<b>Photo for which tag?</b><div style="display:grid;gap:8px;margin-top:12px">
    ${t.tags.map((g) => { const n = nextShot(t, g.id); return `<button class="btn ghost" data-t="${g.id}">${esc(g.tag)}${n ? `<span class="muted" style="font-weight:500"> · next: ${esc(n)}</span>` : ""}</button>`; }).join("")}
    <button class="btn ghost" data-t="">General</button></div>`);
  bg.onclick = (e) => { const b = e.target.closest("[data-t]"); if (b) { bg.remove(); cb(b.dataset.t); } else if (e.target === bg) bg.remove(); };
}

async function openPhoto(testId, photoId, isNew) {
  const t = TESTS.find((x) => x.id === testId);
  const p = t.photos.find((x) => x.id === photoId);
  if (!p) return;
  const u = await photoURL(p.id);
  const bg = sheet(`
    ${u ? `<img src="${u}" alt="">` : `<div class="muted">Photo cleared from phone.</div>`}
    <div class="grid2">
      <div><label>Tag</label><select id="p-tag">${t.tags.map((g) => `<option value="${g.id}"${g.id === p.tagId ? " selected" : ""}>${esc(g.tag)}</option>`).join("")}${p.tagId === FORM ? `<option value="${FORM}" selected>Site test form (whole test)</option>` : ""}<option value=""${!p.tagId ? " selected" : ""}>General</option></select></div>
      <div><label>Shot</label><select id="p-shot"><option value="">Other</option>${opts([...(t.shots || []), FORM_SHOT], p.shot)}</select></div>
    </div>
    <div class="seg" id="p-st">
      <button data-st="A" class="pass ${p.status === "A" ? "on" : ""}">Accepted</button>
      <button data-st="C" class="cmt ${p.status === "C" ? "on" : ""}">Comment</button>
      <button data-st="R" class="fail ${p.status === "R" ? "on" : ""}">Rejected</button>
    </div>
    <div id="p-iss-wrap" ${p.status === "A" ? "hidden" : ""}><label>Issue type</label><select id="p-iss"><option value="">—</option>${opts(S.issues, p.issue)}</select></div>
    <label>Comment</label><textarea id="p-cmt" placeholder="What did you see?">${esc(p.comment)}</textarea>
    <div class="row" style="margin-top:14px"><button class="btn danger" id="p-del">Delete</button>
      ${isNew ? `<button class="btn ghost" id="p-more" style="flex:1">Save + next 📷</button>` : ""}
      <button class="btn" id="p-ok" style="flex:1">Save</button></div>`);
  let status = p.status;
  bg.querySelector("#p-st").onclick = (e) => {
    const b = e.target.closest("button"); if (!b) return;
    status = b.dataset.st;
    bg.querySelectorAll("#p-st button").forEach((x) => x.classList.toggle("on", x === b));
    bg.querySelector("#p-iss-wrap").hidden = status === "A";
  };
  const commit = async () => {
    p.tagId = bg.querySelector("#p-tag").value; p.status = status;
    p.shot = p.tagId === FORM ? FORM_SHOT : bg.querySelector("#p-shot").value;
    p.issue = status === "A" ? "" : bg.querySelector("#p-iss").value;
    p.comment = bg.querySelector("#p-cmt").value.trim();
    await save(t); bg.remove(); renderTest(t.id, true);
  };
  bg.querySelector("#p-ok").onclick = commit;
  if (isNew) bg.querySelector("#p-more").onclick = async () => {
    const tg = bg.querySelector("#p-tag").value; await commit();
    capture(t.id, tg, "any", tg && tg !== FORM ? nextShot(t, tg) : "");
  };
  bg.querySelector("#p-del").onclick = async () => {
    if (!confirm("Delete this photo?")) return;
    t.photos = t.photos.filter((x) => x.id !== p.id); await dbDelPhoto(p.id);
    await save(t); bg.remove(); renderTest(t.id, true);
  };
}

/* ---------------- Settings ---------------- */
function renderSettings() {
  setHeader("Settings", true);
  const ta = (k) => `<label>${k[0].toUpperCase() + k.slice(1)} list (one per line)</label><textarea id="s-${k}" rows="5">${esc((S[k] || []).join("\n"))}</textarea>`;
  $("#view").innerHTML = `
  <div class="card">
    <label style="margin-top:0">Who are you? (team list)</label>${teamSelect("s-member")}
    <div class="hint">Picking your name fills the two boxes below. Not in the list? Type them yourself.</div>
    <label>Your name in reports &amp; WhatsApp (English)</label><input id="s-engineer" value="${esc(S.engineer)}">
    <label>Your name as written in the invitation sheet</label><input id="s-sheetName" value="${esc(S.sheetName || "")}" placeholder="e.g. أحمد علي">
    <label>Project name (report subtitle)</label><input id="s-projectName" value="${esc(S.projectName)}" placeholder="e.g. Holy Haram Expansion">
    <div class="grid2">
      <div><label>Discipline</label><input id="s-discipline" value="${esc(S.discipline)}"></div>
      <div><label>Clear photos after (days)</label><input id="s-purgeDays" type="number" min="0" value="${esc(S.purgeDays)}"></div>
    </div>
    <label>Report title</label><input id="s-reportTitle" value="${esc(S.reportTitle)}">
  </div>
  <div class="card"><b>Auto-sync to laptop</b>
    <div class="hint">Paste the sync link and key from the setup steps. Tap "Finished — sync this test" at the bottom of each test when you're done.</div>
    <label>Sync link</label><input id="s-syncUrl" value="${esc(S.syncUrl)}" placeholder="https://script.google.com/macros/s/…/exec" autocapitalize="off" autocorrect="off">
    <label>Key</label><input id="s-syncKey" value="${esc(S.syncKey)}" autocapitalize="off" autocorrect="off">
    <label style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="s-autoSync" style="width:auto" ${S.autoSync ? "checked" : ""}> Also sync automatically (1.5 min after the last change)</label>
    <button class="btn ghost block" id="s-test" style="margin-top:8px">Test connection</button></div>
  <div class="card"><b>Photo checklists</b>
    <div class="hint">One line per equipment type: <code>keyword | keyword = shot; shot; shot</code>. The first line whose keyword is in the System name is used. <code>*</code> = any other system.</div>
    <textarea id="s-checklists" rows="10" style="font-size:13px">${esc(S.checklists)}</textarea>
    <button class="btn ghost" id="s-ckreset" style="margin-top:8px">Restore default checklists</button></div>
  <div class="card">${ta("issues")}${ta("projects")}${ta("systems")}${ta("activities")}</div>
  <div class="card"><b>Storage</b><div class="muted" id="s-store">Checking…</div><hr>
    <button class="btn ghost block" id="s-reexp">Share ZIP of all tests that still have photos (manual backup)</button></div>`;
  navigator.storage?.estimate?.().then((e) => { $("#s-store").textContent = `${(e.usage / 1048576).toFixed(1)} MB used · ${TESTS.length} test(s) saved`; }).catch(() => ($("#s-store").textContent = `${TESTS.length} test(s) saved`));
  $("#s-reexp").onclick = () => doExport(true);
  $("#s-test").onclick = async () => {
    const url = $("#s-syncUrl").value.trim(), key = $("#s-syncKey").value.trim();
    if (!url) return toast("Paste the sync link first");
    try { const r = await callSync(url, { key, action: "ping" }); toast(r.ok ? "Connected ✓ — files go to " + (r.folder || "Drive") : "Error: " + r.error, 3500); }
    catch (e) { toast("Can't reach the link: " + e.message, 4000); }
  };
  $("#s-ckreset").onclick = () => { $("#s-checklists").value = DEFAULTS.checklists; };
  $("#fab").innerHTML = `<button class="btn" id="s-ok">Save settings</button>`;
  $("#s-member").onchange = (e) => {
    const m = (S.team || []).find((x) => x.ar === e.target.value);
    if (m) { $("#s-engineer").value = m.en || m.ar; $("#s-sheetName").value = m.ar; }
  };
  if (S.syncUrl) loadTeam().then((ch) => { if (ch && route.name === "settings") { const v = $("#s-member").value; $("#s-member").outerHTML = teamSelect("s-member"); renderSettings(); } });
  $("#s-ok").onclick = async () => {
    ["engineer", "sheetName", "projectName", "discipline", "reportTitle"].forEach((k) => (S[k] = $("#s-" + k).value.trim()));
    const m = (S.team || []).find((x) => normName(x.ar) === normName(S.sheetName));
    S.myAliases = m ? m.aliases || [] : [];
    S.purgeDays = Math.max(0, parseFloat($("#s-purgeDays").value) || 0);
    S.checklists = $("#s-checklists").value.trim();
    S.syncUrl = $("#s-syncUrl").value.trim(); S.syncKey = $("#s-syncKey").value.trim(); S.autoSync = $("#s-autoSync").checked;
    ["issues", "projects", "systems", "activities"].forEach((k) => (S[k] = $("#s-" + k).value.split(/\n/).map((x) => x.trim()).filter(Boolean)));
    await kvSet("settings", S); toast("Saved"); go({ name: "home" });
  };
}

/* ---------------- Export ---------------- */
async function getPhotoBuf(id) {
  const b = await dbGetPhoto(id);
  return b ? new Uint8Array(await b.arrayBuffer()) : null;
}
// Smaller copy for the Word report (full-size photos still go in the folder) — keeps uploads light
async function getPhotoSmall(id) {
  const b = await dbGetPhoto(id);
  if (!b) return null;
  try {
    const img = await new Promise((res, rej) => { const u = URL.createObjectURL(b); const im = new Image(); im.onload = () => { URL.revokeObjectURL(u); res(im); }; im.onerror = rej; im.src = u; });
    const k = Math.min(1, 1100 / Math.max(img.width, img.height));
    if (k >= 1) return new Uint8Array(await b.arrayBuffer());
    const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    const sb = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.72));
    return new Uint8Array(await sb.arrayBuffer());
  } catch { return new Uint8Array(await b.arrayBuffer()); }
}
async function doExport(all) {
  const list = TESTS.filter((t) => all ? !t.photosPurged : needsExport(t));
  if (!list.length) return toast("Nothing new to export");
  toast("Building reports…", 1800);
  try {
    const blob = await Report.buildExportZip(list, TESTS, S, getPhotoBuf);
    const d = new Date();
    const name = `SiteTests_${today()}_${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}.zip`;
    const file = new File([blob], name, { type: "application/zip" });
    let done = false;
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); done = true; }
      catch (e) { if (e.name === "AbortError") return toast("Export cancelled"); }
    }
    if (!done) {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
      done = confirm("Did the file save?");
    }
    if (done) {
      const now = Date.now();
      for (const t of list) { t.exportedAt = now; await dbPutTest(t); }
      toast(`Exported ${list.length} test(s) ✓`);
      render();
    }
  } catch (e) { console.error(e); alert("Export failed: " + e.message); }
}

/* ---------------- Auto-sync (Google Apps Script → Drive → laptop) ---------------- */
const SYNC = { state: "idle", last: 0, msg: "", timer: null, busy: false };
function syncLabel() {
  const n = TESTS.filter(needsExport).length;
  if (SYNC.state === "busy") return `☁︎ Syncing… ${SYNC.msg}`;
  if (SYNC.state === "offline") return `☁︎ No internet — ${n} test(s) will sync when online`;
  if (SYNC.state === "error") return `⚠︎ Sync failed: ${SYNC.msg} — tap to retry`;
  if (n) return `☁︎ ${n} test(s) not synced yet — tap to sync all`;
  return `☁︎ All synced${SYNC.last ? " · " + new Date(SYNC.last).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}`;
}
function paintSync() {
  const b = document.getElementById("sync-bar");
  if (b) { b.className = "sync-bar " + SYNC.state; b.textContent = syncLabel(); b.onclick = () => syncNow(true); }
}
function scheduleSync(ms) {
  if (!S.syncUrl || !S.autoSync) return;
  clearTimeout(SYNC.timer);
  SYNC.timer = setTimeout(() => syncNow(false), ms);
}
async function callSync(url, payload) {
  // text/plain keeps it a "simple" request (no CORS preflight) — Apps Script accepts it
  const r = await fetch(url, { method: "POST", body: JSON.stringify(payload), redirect: "follow" });
  const txt = await r.text();
  try { return JSON.parse(txt); } catch { throw new Error(r.ok ? "unexpected reply (check the link and that access is 'Anyone')" : "HTTP " + r.status); }
}
function blobToBase64(blob) {
  return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(",")[1]); fr.onerror = () => rej(fr.error); fr.readAsDataURL(blob); });
}
// Sends the ZIP in ~3 MB pieces (one big request fails on mobile data); each piece retried 3 times.
async function uploadInParts(name, b64, progress) {
  const CH = 4 * 1024 * 1024; // base64 chars, multiple of 4
  const total = Math.max(1, Math.ceil(b64.length / CH));
  for (let i = 0; i < total; i++) {
    progress(i + 1, total);
    let last;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await callSync(S.syncUrl, { key: S.syncKey, action: "upload_chunk", name, index: i, total, data: b64.slice(i * CH, (i + 1) * CH) });
        if (r.ok) { last = null; break; }
        if (r.error === "unknown action") throw new Error("Update the Google sync script (new version needed for big tests)");
        last = new Error(r.error || "upload refused");
      } catch (e) {
        if (/Update the Google sync script/.test(e.message)) throw e;
        last = e; await new Promise((res) => setTimeout(res, 2000 * (attempt + 1)));
      }
    }
    if (last) throw new Error(`${last.message} (part ${i + 1}/${total})`);
  }
}

async function syncNow(manual, onlyId) {
  if (!S.syncUrl || SYNC.busy) return;
  const list = TESTS.filter((t) => needsExport(t) && (!onlyId || t.id === onlyId));
  if (!list.length) { if (manual) toast("Everything is already sent ✓"); SYNC.state = "idle"; paintSync(); return; }
  if (!navigator.onLine) { SYNC.state = "offline"; paintSync(); if (manual) toast("No internet — will sync when you're back online"); return; }
  SYNC.busy = true; SYNC.state = "busy";
  let sent = 0;
  try {
    for (const t of list) {
      SYNC.msg = `${sent + 1}/${list.length}`; paintSync();
      const stamp = t.updatedAt || Date.now();
      const blob = await Report.buildExportZip([t], TESTS, S, getPhotoBuf, getPhotoSmall);
      if (blob.size > 150 * 1048576) throw new Error(`"${t.system}" is too big (${(blob.size / 1048576).toFixed(0)} MB) — use manual export`);
      const name = `SiteTests_${t.date}_${String(t.sr || 0).padStart(2, "0")}_${t.id}_${Date.now()}.zip`;
      await uploadInParts(name, await blobToBase64(blob), (i, n) => { SYNC.msg = `${sent + 1}/${list.length}` + (n > 1 ? ` · part ${i}/${n}` : ""); paintSync(); });
      if ((t.updatedAt || 0) === stamp) { t.exportedAt = Date.now(); await dbPutTest(t); } // changed meanwhile → next round
      await learnChecklist(t);
      sent++;
    }
    SYNC.state = "idle"; SYNC.last = Date.now();
    if (manual) toast(`Sent ${sent} test(s) ✓ — on the laptop within 5 min`);
  } catch (e) {
    console.error(e);
    SYNC.state = navigator.onLine ? "error" : "offline"; SYNC.msg = e.message;
    if (manual) toast("Sync failed: " + e.message, 4000);
    scheduleSync(5 * 60000);
  } finally {
    SYNC.busy = false; paintSync();
    if (route.name === "home") renderHome();
    if (TESTS.some(needsExport) && SYNC.state === "idle") scheduleSync(90000);
  }
}

/* ---------------- Plans: tests prepared on the laptop or by Claude ----------------
   JSON: { "tests": [ { date, sr, project, time, system, activity, witness, remarks,
                        tags: [ { tag, zone, bundle, qty } ] } ] }                     */
const IS_DESKTOP = window.matchMedia && matchMedia("(pointer: fine)").matches && !/iPhone|iPad|Android/i.test(navigator.userAgent);
// Arabic-friendly name matching: أحمد = احمد, spaces/diacritics ignored
function normName(s) {
  return String(s || "").replace(/[\u064B-\u0652\u0640]/g, "").replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
}
function splitNames(s) { return String(s || "").split(/[,،\n&\/]+| و (?=\S)/).map((x) => x.trim()).filter(Boolean); }
// ---- team list (kept on Google Drive, cached on the phone) ----
async function loadTeam() {
  if (!S.syncUrl || !navigator.onLine) return false;
  try {
    const r = await callSync(S.syncUrl, { key: S.syncKey, action: "team" });
    if (!r.ok || !Array.isArray(r.members)) return false;
    const changed = JSON.stringify(r.members) !== JSON.stringify(S.team || []);
    S.team = r.members; S.teamAt = Date.now();
    const m = S.sheetName && S.team.find((x) => normName(x.ar) === normName(S.sheetName));
    if (m) S.myAliases = m.aliases || [];
    await kvSet("settings", S);
    return changed;
  } catch { return false; }
}
function teamSelect(id) {
  const list = [...(S.team || [])].sort((a, b) => (a.en || a.ar).localeCompare(b.en || b.ar));
  if (!list.length) return `<select id="${id}" disabled><option value="">Team list not loaded yet (needs internet + sync link)</option></select>`;
  return `<select id="${id}"><option value="">— Choose your name —</option>${list.map((m) =>
    `<option value="${esc(m.ar)}"${normName(m.ar) === normName(S.sheetName) ? " selected" : ""}>${esc(m.en ? `${m.en} — ${m.ar}` : m.ar)}</option>`).join("")}</select>`;
}
function applyMember(ar) {
  const m = (S.team || []).find((x) => x.ar === ar);
  if (!m) return;
  S.sheetName = m.ar; S.engineer = m.en || m.ar; S.myAliases = m.aliases || [];
}

async function getPlans() {
  if (!navigator.onLine) return toast("No internet");
  toast("Checking…", 1200);
  try {
    const r = await callSync(S.syncUrl, { key: S.syncKey, action: "plans" });
    if (!r.ok) throw new Error(r.error);
    let added = 0, skipped = 0, notMine = 0, updated = 0, flagged = 0, removed = 0;
    const team = !!S.sheetName;   // team mode: only my rows, and plans stay on Drive for the others
    const me = normName(S.sheetName);
    const mine = new Set([S.sheetName, ...(S.myAliases || [])].map(normName));
    // several publishes of the same day's sheet can be on Drive -> use only the NEWEST one per date
    const parsed = [];
    for (const pl of r.plans || []) { try { parsed.push({ pl, data: JSON.parse(pl.content) }); } catch {} }
    const newest = {};
    for (const p of parsed) {
      if (!/_xlsx_/.test(p.pl.name || "") || !p.data.rev) continue;
      const d = (p.data.tests && p.data.tests[0] && p.data.tests[0].date) || "";
      if (!newest[d] || p.data.rev > newest[d].data.rev) newest[d] = p;
    }
    const use = parsed.filter((p) => !/_xlsx_/.test(p.pl.name || "") || !p.data.rev ||
      newest[(p.data.tests && p.data.tests[0] && p.data.tests[0].date) || ""] === p);
    for (const { pl, data } of use) {
      for (const x0 of data.tests || []) {
        const names = x0.witnesses && x0.witnesses.length ? x0.witnesses : [x0.witness, ...splitNames(x0.withMe)].filter(Boolean);
        let x = x0;
        if (team) {
          // the test belongs to the FIRST name in the witness cell; the others appear as "with me"
          const first = normName(names[0]);
          if (!(mine.has(first) || (me.length > 5 && first.includes(me)))) {
            notMine++;
            // the row was moved to someone else and I haven't started it -> remove my copy
            const was = TESTS.find((t) => t.date === x0.date && String(t.sr) === String(x0.sr) && t.system === x0.system && t.planSig && !hasWork(t));
            if (was) { TESTS = TESTS.filter((t) => t !== was); await dbDelTest(was.id); removed++; }
            continue;
          }
          x = { ...x0, witness: S.engineer || S.sheetName, withMe: names.filter((n) => !mine.has(normName(n))).join("، ") };
        } else if (x0.witnesses && !x0.withMe) {
          x = { ...x0, witness: names[0] || "", withMe: names.slice(1).join("، ") };
        }
        const sig = JSON.stringify([x.time, x.project, x.activity, x.withMe, x.remarks, x.tags]);
        const mkTags = () => {
          const tags = [];
          for (const g of x.tags || []) for (const u of expandTag(String(g.tag || "").trim(), parseInt(g.qty, 10) || 1))
            tags.push({ id: uid(), tag: u, zone: g.zone || "", bundle: g.bundle || "", status: "", remark: "" });
          return tags;
        };
        const same = TESTS.find((t) => t.date === x.date && String(t.sr) === String(x.sr) && t.system === x.system);
        if (same) {
          if (same.planSig === sig) { skipped++; continue; }
          if (!hasWork(same)) {           // the sheet was edited and I haven't started -> take the new version
            Object.assign(same, { project: x.project || "", time: x.time || "", activity: x.activity || "", withMe: x.withMe || "",
              remarks: x.remarks || "", tags: mkTags(), planSig: sig, sheetChanged: false });
            await dbPutTest(same); updated++;
          } else if (!same.sheetChanged) { // already working on it -> don't touch, just flag it
            same.sheetChanged = true; same.planSig = sig; await dbPutTest(same); flagged++;
          } else skipped++;
          continue;
        }
        const t = { id: uid(), date: x.date || today(), sr: String(x.sr ?? ""), project: x.project || "", time: x.time || "", system: x.system || "",
          activity: x.activity || "", witness: x.witness || S.engineer, withMe: x.withMe || "", location: x.location || "", remarks: x.remarks || "", tags: mkTags(), photos: [], shots: shotsFor(x.system), createdAt: Date.now(), planSig: sig };
        TESTS.push(t); await dbPutTest(t); added++;
      }
      if (!team) await callSync(S.syncUrl, { key: S.syncKey, action: "delete", id: pl.id });
    }
    const bits = [added && `${added} new`, updated && `${updated} updated from the sheet`, removed && `${removed} moved to someone else`, flagged && `${flagged} changed in the sheet after you started — check them`].filter(Boolean);
    toast(bits.length ? bits.join(" · ") + " ✓" : skipped ? "Your tests are already here" : team && notMine ? "No tests for you in today's sheet" : "No new tests waiting", bits.length ? 4000 : 2600);
    render();
  } catch (e) { toast("Couldn't get tests: " + e.message, 4000); }
}
async function sendPlans() {
  const list = TESTS.filter((t) => !t.photos.length && !t.exportedAt);
  if (!list.length) return;
  if (!confirm(`Send ${list.length} test(s) to the phone?\nThey'll be removed from this computer after sending.`)) return;
  const tests = list.map((t) => ({ date: t.date, sr: t.sr, project: t.project, time: t.time, system: t.system, activity: t.activity,
    witness: t.witness, withMe: t.withMe, location: t.location, remarks: t.remarks, tags: t.tags.map((g) => ({ tag: g.tag, zone: g.zone, bundle: g.bundle, qty: 1 })) }));
  try {
    const r = await callSync(S.syncUrl, { key: S.syncKey, action: "plan_put", data: JSON.stringify({ tests }) });
    if (!r.ok) throw new Error(r.error);
    for (const t of list) await dbDelTest(t.id);
    TESTS = TESTS.filter((t) => !list.includes(t));
    toast(`Sent ✓ — on the phone tap "Get today's tests"`, 3500); render();
  } catch (e) { toast("Couldn't send: " + e.message, 4000); }
}

/* ---------------- Clean-up of exported photos ---------------- */
async function purgeOld() {
  const limit = (S.purgeDays ?? 2) * 86400000;
  for (const t of TESTS) {
    if (t.photosPurged || !t.exportedAt || (t.updatedAt || 0) > t.exportedAt) continue;
    if (Date.now() - t.exportedAt < limit) continue;
    for (const p of t.photos) { await dbDelPhoto(p.id); urls.delete(p.id); }
    t.photosPurged = true; await dbPutTest(t);
  }
}

/* ---------------- Boot ---------------- */
(async function boot() {
  $("#cam").onchange = onFiles; $("#pick").onchange = onFiles; $("#any").onchange = onFiles;
  try {
    await openDB();
    S = { ...DEFAULTS, ...((await kvGet("settings")) || {}) };
    TESTS = await dbAllTests();
    TESTS.forEach((t) => { t.tags ||= []; t.photos ||= []; });
    await purgeOld();
    navigator.storage?.persist?.();
  } catch (e) {
    $("#view").innerHTML = `<div class="empty">Storage is not available: ${esc(e.message)}.<br>Open the app from the Home Screen icon, not a private tab.</div>`;
    return;
  }
  render();
  window.addEventListener("online", () => scheduleSync(3000));
  window.addEventListener("offline", () => { SYNC.state = "offline"; paintSync(); });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") scheduleSync(3000); });
  scheduleSync(3000);
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
