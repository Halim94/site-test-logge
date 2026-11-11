/* Site Test Logger — report, log and export builders.
   Works in the browser (globals docx, XLSX, JSZip) and in Node (for testing). */
(function (root) {
  const isNode = typeof module !== "undefined" && module.exports;
  const docx = isNode ? require("docx") : root.docx;
  const XLSX = isNode ? require("xlsx") : root.XLSX;
  const JSZip = isNode ? require("jszip") : root.JSZip;

  const STATUS = { A: "Accepted", R: "Rejected", C: "Comment" };
  const pad = (n) => String(n).padStart(2, "0");
  const FORM = "__form";              // old: one form per test
  const FORM_SHOT = "Site test form";  // now: form pages inside each tag
  const isForm = (p) => p.tagId === FORM || p.shot === FORM_SHOT;
  const formsOf = (test, tagId) => (test.photos || []).filter((p) => p.tagId === tagId && p.shot === FORM_SHOT);
  function shotProgress(test, tag) {
    const shots = test.shots || [];
    const ps = photosOf(test, tag.id);
    const missing = shots.filter((s) => !ps.some((p) => p.shot === s));
    return { total: shots.length, done: shots.length - missing.length, missing };
  }

  function photosOf(test, tagId) {
    return (test.photos || []).filter((p) => (p.tagId || "") === (tagId || ""));
  }

  /* Tag status: manual choice wins; otherwise any rejected photo = Fail, any photo = Pass. */
  function tagStatus(test, tag) {
    if (tag.status) return tag.status;
    const ps = photosOf(test, tag.id).filter((p) => !isForm(p));
    if (ps.some((p) => p.status === "R")) return "Fail";
    if (ps.length) return "Pass";
    return "Pending";
  }

  function tagRemark(test, tag) {
    const parts = [];
    if (tag.remark) parts.push(tag.remark);
    photosOf(test, tag.id).filter((p) => p.status !== "A").forEach((p) => {
      const t = [p.issue, p.comment].filter(Boolean).join(": ");
      if (t && !parts.includes(t)) parts.push(t);
    });
    return parts.join("; ");
  }

  function testStatus(test) {
    const st = (test.tags || []).map((t) => tagStatus(test, t));
    if (!st.length) return "Pending";
    const pass = st.filter((s) => s === "Pass").length;
    const fail = st.filter((s) => s === "Fail").length;
    const pend = st.length - pass - fail;
    if (pend === st.length) return "Pending";
    if (fail === 0 && pend === 0) return "Pass";
    if (pass === 0 && pend === 0) return "Fail";
    return `Partial (${pass} Pass / ${fail} Fail${pend ? ` / ${pend} Pending` : ""})`;
  }

  function issueCounts(test) {
    const c = {};
    (test.photos || []).filter((p) => p.status !== "A").forEach((p) => {
      const k = p.issue || "Other";
      c[k] = (c[k] || 0) + 1;
    });
    return c;
  }
  const issueText = (c) => Object.entries(c).map(([k, v]) => `${k} (${v})`).join(", ");

  /* Short text for the WhatsApp group, e.g.
     Pre-Commissioning & I/O Testing – BMS DCP
     Location: Haram North Bridges - Bridge A Second Floor
     1- DCP/SHZ-SFA-10...Pass
     Engineer Abdelhalim Tarik & Ahmed Ali                                   */
  function whatsappText(test, settings = {}) {
    const uniq = (a) => [...new Set(a.map((x) => String(x || "").trim()).filter(Boolean))];
    const title = [test.activity, test.system].filter(Boolean).join(" – ") || "Test";
    const loc = test.location || [test.project, uniq((test.tags || []).map((g) => g.zone)).join(", ")].filter(Boolean).join(" - ");
    const lines = [title];
    if (loc) lines.push(`Location: ${loc}`);
    (test.tags || []).forEach((g, i) => {
      const st = tagStatus(test, g);
      const why = st === "Fail" ? tagRemark(test, g) : "";
      lines.push(`${i + 1}- ${g.tag}...${st}${why ? ` (${why})` : ""}`);
    });
    if (test.remarks) lines.push(test.remarks);
    const names = [settings.engineer || test.witness, ...String(test.withMe || "").split(/[,،\n&]+/)].map((x) => String(x || "").trim()).filter(Boolean);
    if (names.length) lines.push(`Engineer ${uniq(names).join(" & ")}`);
    return lines.join("\n");
  }

  function summaryText(test) {
    const tags = test.tags || [];
    const st = tags.map((t) => ({ t, s: tagStatus(test, t) }));
    const pass = st.filter((x) => x.s === "Pass").map((x) => x.t.tag);
    const fail = st.filter((x) => x.s === "Fail").map((x) => x.t.tag);
    const pend = st.filter((x) => x.s === "Pending").map((x) => x.t.tag);
    let out = `${test.activity || "Test"} for ${tags.length} item(s) of ${test.system || "equipment"}`;
    if (test.project) out += ` at ${test.project}`;
    out += ". ";
    if (pass.length) out += `Passed: ${pass.join(", ")}. `;
    if (fail.length) out += `Failed: ${fail.join(", ")}. `;
    if (pend.length) out += `Not witnessed / pending: ${pend.join(", ")}. `;
    const ic = issueCounts(test);
    if (Object.keys(ic).length) out += `Observations: ${issueText(ic)}.`;
    return out.trim();
  }

  function safe(s) {
    return String(s || "").replace(/[\\/:*?"<>|\[\]\r\n\t]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 50);
  }
  function folderName(test) {
    return [pad(test.sr || 0), test.project, test.system].map(safe).filter(Boolean).join(" - ");
  }
  function folderPath(test) {
    // one folder per test, ordered by Sr. (the laptop adds the engineer's name only if two people sync the same Sr.)
    return `Tests/${test.date}/${folderName(test)}`;
  }
  function photoFiles(test) {
    // name photos by tag + running number per tag
    const counter = {};
    const tagName = {};
    (test.tags || []).forEach((t) => (tagName[t.id] = t.tag));
    return (test.photos || []).map((p) => {
      if (p.tagId === FORM) { counter[FORM] = (counter[FORM] || 0) + 1; return `00_Site_Test_Form_page${pad(counter[FORM])}.jpg`; }
      const tn = safe(String(tagName[p.tagId] || "General").split(" ")[0]);
      if (p.shot === FORM_SHOT) { const k = tn + "|form"; counter[k] = (counter[k] || 0) + 1; return `${tn}_Site_Test_Form_p${pad(counter[k])}.jpg`; }
      const base = p.shot ? `${tn}_${safe(p.shot)}` : tn;
      counter[base] = (counter[base] || 0) + 1;
      const st = { A: "OK", R: "REJ", C: "CMT" }[p.status] || "NA";
      return `${base}_${pad(counter[base])}_${st}${p.issue && p.status !== "A" ? "_" + safe(p.issue) : ""}.jpg`;
    });
  }

  /* ---------------- Word report ---------------- */
  const COLOR = { Pass: "1E8449", Fail: "C0392B", Pending: "808B96", Rejected: "C0392B", Accepted: "1E8449", Comment: "B9770E" };
  const colorFor = (s) => COLOR[s] || (String(s).startsWith("Partial") ? "B9770E" : "000000");

  async function buildDocx(test, settings, getPhoto) {
    const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, ImageRun,
      AlignmentType, BorderStyle, ShadingType, Footer, PageNumber } = docx;
    const FONT = "Calibri";
    const thin = { style: BorderStyle.SINGLE, size: 4, color: "BFC5CC" };
    const borders = { top: thin, bottom: thin, left: thin, right: thin };
    const W = 9638;
    const txt = (t, o = {}) => new TextRun({ text: String(t ?? ""), font: FONT, size: o.size || 20, bold: o.bold, color: o.color });
    const cell = (t, o = {}) => new TableCell({
      borders, width: { size: o.w, type: WidthType.DXA },
      shading: o.fill ? { type: ShadingType.CLEAR, color: "auto", fill: o.fill } : undefined,
      margins: { top: 50, bottom: 50, left: 90, right: 90 },
      children: String(t ?? "").split("\n").map((line) => new Paragraph({ children: [txt(line, o)] })),
    });
    const h2 = (t, o = {}) => new Paragraph({ pageBreakBefore: o.pb, spacing: { before: 240, after: 100 }, children: [txt(t, { size: 26, bold: true, color: "1B2631" })] });

    const status = testStatus(test);
    const info = [
      ["Project", test.project], ["Date / Time", [test.date, test.time].filter(Boolean).join("  ·  ")],
      ["Sr. (Invitation)", test.sr], ["Equipment / System", test.system],
      ["Activity", test.activity], ["Discipline", settings.discipline],
      ["Witness T&C Engineer", [test.witness || settings.engineer, test.withMe].filter(Boolean).join(" & ")],
    ].filter(([, v]) => v !== undefined && v !== "");

    const children = [
      new Paragraph({ spacing: { after: 60 }, children: [txt(settings.reportTitle || "T&C Test Witness Report", { size: 34, bold: true, color: "1B2631" })] }),
      new Paragraph({ spacing: { after: 160 }, children: [txt(settings.projectName || "", { size: 20, color: "566573" })] }),
      new Table({
        width: { size: W, type: WidthType.DXA }, columnWidths: [2800, W - 2800],
        rows: info.map(([k, v]) => new TableRow({ children: [cell(k, { w: 2800, bold: true, fill: "EEF2F6" }), cell(v, { w: W - 2800 })] })),
      }),
      new Paragraph({ spacing: { before: 240, after: 100 }, children: [txt("STATUS:  ", { size: 26, bold: true }), txt(status.toUpperCase(), { size: 26, bold: true, color: colorFor(status) })] }),
      ...whatsappText(test, settings).split("\n").map((l, i) => new Paragraph({ spacing: { after: 40 }, children: [txt(l, { bold: i === 0 })] })),
    ];

    // Equipment table — mirrors the invitation sheet
    const cw = [1500, 2100, 1000, 1000, W - 5600];
    children.push(h2("Equipment Status"));
    children.push(new Table({
      width: { size: W, type: WidthType.DXA }, columnWidths: cw,
      rows: [
        new TableRow({ tableHeader: true, children: ["Zone / Floor", "Tag Name", "Bundle", "Status", "Remarks"].map((h, k) => cell(h, { w: cw[k], bold: true, fill: "1F3864", color: "FFFFFF" })) }),
        ...(test.tags || []).map((t) => {
          const s = tagStatus(test, t);
          return new TableRow({ cantSplit: true, children: [
            cell(t.zone, { w: cw[0] }), cell(t.tag, { w: cw[1], bold: true }), cell(t.bundle, { w: cw[2] }),
            cell(s, { w: cw[3], bold: true, color: colorFor(s) }),
            cell(tagRemark(test, t), { w: cw[4] }),
          ] });
        }),
      ],
    }));


    // Photo log grouped by tag, 2 per row
    const names = photoFiles(test);
    const items = [];
    for (let i = 0; i < (test.photos || []).length; i++) {
      const p = test.photos[i];
      const data = await getPhoto(p.id);
      if (data) items.push({ p, data, name: names[i] });
    }
    if (items.some((x) => !isForm(x.p))) {
      children.push(h2("Photo Log", { pb: true }));
      const groups = [...(test.tags || []).map((t) => ({ id: t.id, label: t.tag })), { id: "", label: "General" }];
      const half = W / 2;
      for (const g of groups) {
        const order = (s) => { const i = (test.shots || []).indexOf(s); return i < 0 ? 999 : i; };
        const gi = items.filter((x) => (x.p.tagId || "") === g.id && !isForm(x.p)).sort((a, b) => order(a.p.shot) - order(b.p.shot));
        if (!gi.length) continue;
        children.push(new Paragraph({ spacing: { before: 160, after: 80 }, children: [txt(g.label, { size: 22, bold: true, color: "1F3864" })] }));
        const rows = [];
        for (let k = 0; k < gi.length; k += 2) {
          rows.push(new TableRow({ cantSplit: true, children: [gi[k], gi[k + 1]].map((x) => {
            if (!x) return new TableCell({ borders, width: { size: half, type: WidthType.DXA }, children: [new Paragraph("")] });
            const ratio = x.p.h && x.p.w ? x.p.h / x.p.w : 0.75;
            let imgW = 300, imgH = Math.round(300 * ratio);
            if (imgH > 400) { imgH = 400; imgW = Math.round(400 / ratio); }
            const kids = [
              new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ data: x.data, transformation: { width: imgW, height: imgH } })] }),
              new Paragraph({ spacing: { before: 60 }, children: [
                txt(x.p.shot ? `${x.p.shot} — ` : "", { bold: true, size: 18 }),
                txt(STATUS[x.p.status] || "", { bold: true, size: 18, color: colorFor(STATUS[x.p.status]) }),
                txt(x.p.issue && x.p.status !== "A" ? ` · ${x.p.issue}` : "", { size: 18, bold: true }),
              ] }),
            ];
            if (x.p.comment) kids.push(new Paragraph({ children: [txt(x.p.comment, { size: 18 })] }));
            return new TableCell({ borders, width: { size: half, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 80, right: 80 }, children: kids });
          }) }));
        }
        children.push(new Table({ width: { size: W, type: WidthType.DXA }, columnWidths: [half, half], rows }));
      }
    }

    const tagLabel = {}; (test.tags || []).forEach((g) => (tagLabel[g.id] = g.tag));
    const pageNo = {};
    const forms = items.filter((x) => isForm(x.p));
    forms.forEach((x) => {
      const key = x.p.tagId || "";
      const k = (pageNo[key] = (pageNo[key] || 0) + 1) - 1;
      const ratio = x.p.h && x.p.w ? x.p.h / x.p.w : 1.414;
      let w = 640, h = Math.round(640 * ratio);
      if (h > 860) { h = 860; w = Math.round(860 / ratio); }
      children.push(new Paragraph({ pageBreakBefore: true, spacing: { after: 80 }, children: [txt(`Site Test Form — ${tagLabel[key] || "General"} — page ${k + 1}`, { size: 22, bold: true, color: "1F3864" })] }));
      children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ data: x.data, transformation: { width: w, height: h } })] }));
    });

    const doc = new Document({
      creator: settings.engineer || "Site Test Logger",
      title: `${test.system || "Test"} ${test.date}`,
      sections: [{
        properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
        footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [
          txt(`${test.date}  ·  ${test.project || ""}  ·  ${test.system || ""}  ·  Page `, { size: 16, color: "808B96" }),
          new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 16, color: "808B96" }),
        ] })] }) },
        children,
      }],
    });
    return isNode ? Packer.toBuffer(doc) : Packer.toBlob(doc);
  }

  /* ---------------- Excel log (one row per tag, same columns as the invitation) ---------------- */
  function sortTests(tests) {
    return [...tests].sort((a, b) => `${a.date}|${pad(a.sr || 0)}|${a.createdAt}`.localeCompare(`${b.date}|${pad(b.sr || 0)}|${b.createdAt}`));
  }

  function buildLogWorkbook(tests, settings = {}) {
    const sorted = sortTests(tests);
    const head = ["Date", "Day", "Sr.", "Project", "Zone/Floor", "Time", "Equipment/System", "Equipment Tag Name", "Qty.", "Activity", "Bundle", "Witness T&C Engineer", "Status (Pass/Fail)", "Remarks", "Photos", "Missing Photos", "Site Form", "Report"];
    const rows = [], links = [];
    sorted.forEach((t) => {
      const day = new Date(t.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short" });
      (t.tags || []).forEach((g) => {
        rows.push([t.date, day, t.sr, t.project, g.zone, t.time, t.system, g.tag, 1, t.activity, g.bundle, t.witness || settings.engineer || "",
          tagStatus(t, g), tagRemark(t, g), ...(() => { const sp = shotProgress(t, g); return [sp.total ? `${sp.done}/${sp.total}` : photosOf(t, g.id).length, sp.missing.join(", ")]; })(),
          formsOf(t, g.id).length || (t.photos || []).some((p) => p.tagId === FORM) ? "Yes" : "No", "Open"]);
        links.push(`${folderPath(t)}/Report.docx`.replace(/\//g, "\\"));
      });
    });
    const ws = XLSX.utils.aoa_to_sheet([head, ...rows]);
    links.forEach((l, i) => { ws[XLSX.utils.encode_cell({ r: i + 1, c: head.length - 1 })].l = { Target: l }; });
    ws["!cols"] = [11, 5, 4, 16, 18, 6, 22, 26, 5, 26, 12, 18, 16, 45, 7, 35, 8, 7].map((w) => ({ wch: w }));
    ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: head.length - 1 } }) };

    const ih = ["Date", "Project", "Equipment/System", "Tag", "Zone/Floor", "Shot", "Photo Status", "Issue Type", "Comment", "Photo File"];
    const ir = [];
    sorted.forEach((t) => {
      const names = photoFiles(t);
      const tg = {}; (t.tags || []).forEach((g) => (tg[g.id] = g));
      (t.photos || []).forEach((p, i) => {
        if (p.status === "A") return;
        const g = tg[p.tagId] || {};
        ir.push([t.date, t.project, t.system, g.tag || "General", g.zone || "", p.shot || "", STATUS[p.status], p.issue || "", p.comment || "", names[i]]);
      });
    });
    const ws2 = XLSX.utils.aoa_to_sheet([ih, ...ir]);
    ws2["!cols"] = [11, 16, 22, 26, 18, 22, 12, 22, 60, 40].map((w) => ({ wch: w }));
    ws2["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: ir.length, c: ih.length - 1 } }) };

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Log");
    XLSX.utils.book_append_sheet(wb, ws2, "Issues");
    return XLSX.write(wb, { bookType: "xlsx", type: isNode ? "buffer" : "array" });
  }

  /* ---------------- Export ZIP ---------------- */
  async function buildExportZip(toExport, allTests, settings, getPhoto, getPhotoForReport) {
    const reportPhoto = getPhotoForReport || getPhoto;
    const eng = settings.engineer || "";
    toExport = toExport.map((t) => ({ ...t, engineer: t.engineer || eng }));
    allTests = allTests.map((t) => ({ ...t, engineer: t.engineer || eng }));
    const zip = new JSZip();
    for (const t of toExport) {
      const dir = folderPath(t);
      const names = photoFiles(t);
      for (let i = 0; i < (t.photos || []).length; i++) {
        const data = await getPhoto(t.photos[i].id);
        if (data) zip.file(`${dir}/${names[i]}`, data);
      }
      zip.file(`${dir}/Report.docx`, await buildDocx(t, settings, reportPhoto));
      const tg = {}; (t.tags || []).forEach((g) => (tg[g.id] = g.tag));
      const meta = {
        id: t.id, engineer: t.engineer || "", date: t.date, time: t.time, sr: t.sr, project: t.project, system: t.system, activity: t.activity,
        witness: t.witness || settings.engineer, withMe: t.withMe || "", location: t.location || "", remarks: t.remarks, status: testStatus(t), summary: summaryText(t),
        tags: (t.tags || []).map((g) => ({ tag: g.tag, zone: g.zone, bundle: g.bundle, status: tagStatus(t, g), remarks: tagRemark(t, g), missingPhotos: shotProgress(t, g).missing })),
        photos: (t.photos || []).map((p, i) => ({ file: names[i], tag: p.tagId === FORM ? "Site test form" : tg[p.tagId] || "General", shot: p.shot || "", status: STATUS[p.status], issue: p.issue || "", comment: p.comment || "" })),
      };
      zip.file(`${dir}/data.json`, JSON.stringify(meta, null, 2));
      zip.file(`${dir}/WhatsApp.txt`, "\ufeff" + whatsappText(t, settings).replace(/\n/g, "\r\n"));
    }
    // team logs are built on the laptop (Team_Log.csv + Daily Status); only single-user mode still sends its own log
    if (!settings.sheetName) zip.file("Test_Log.xlsx", buildLogWorkbook(allTests, settings));
    return zip.generateAsync({ type: isNode ? "nodebuffer" : "blob", compression: "STORE" });
  }

  const api = { whatsappText, STATUS, tagStatus, tagRemark, testStatus, summaryText, folderPath, photoFiles, buildDocx, buildLogWorkbook, buildExportZip };
  if (isNode) module.exports = api; else root.Report = api;
})(typeof window !== "undefined" ? window : globalThis);
