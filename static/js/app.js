/* ============ PulmoLens front-end ============ */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ease = (t) => 1 - Math.pow(1 - t, 4);

const state = {
  file: null, fileName: "",
  model: "custom_cnn", threshold: "default", preset: "balanced",
  xaitab: "lime", limemode: "heat",
  session: null, image: null, lime: null, shap: null,
  perfmodel: "Custom CNN", curve: "accuracy",
  metrics: null, chart: null,
};

/* ---------------- helpers ---------------- */
function countUp(el, to, dec = 0, dur = 1400, suffix = "") {
  const from = 0, t0 = performance.now();
  const step = (now) => {
    const p = Math.min(1, (now - t0) / dur);
    el.textContent = (from + (to - from) * ease(p)).toFixed(dec) + suffix;
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.classList.add("show");
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), 4200);
}

/* ---------------- reveal on scroll ---------------- */
const io = new IntersectionObserver((entries) => {
  entries.forEach((e) => {
    if (!e.isIntersecting) return;
    e.target.classList.add("in");
    $$("[data-count]", e.target).forEach((c) => { if (!c._done) { c._done = 1; countUp(c, +c.dataset.count, +c.dataset.dec); } });
    if (e.target.classList.contains("step")) e.target.closest(".pipeline")?.classList.add("in");
    io.unobserve(e.target);
  });
}, { threshold: 0.15, rootMargin: "0px 0px -40px 0px" });
const observeReveals = (root = document) => $$(".reveal:not(.in)", root).forEach((el) => io.observe(el));
observeReveals();

/* ---------------- nav + scroll progress ---------------- */
const sections = ["analyze", "performance", "how", "gallery"].map((id) => document.getElementById(id));
function onScroll() {
  const h = document.documentElement;
  $("#scrollBar").style.width = (h.scrollTop / (h.scrollHeight - h.clientHeight)) * 100 + "%";
  $("#nav").classList.toggle("scrolled", h.scrollTop > 20);
  let cur = null;
  sections.forEach((s) => { if (s.getBoundingClientRect().top < innerHeight * 0.4) cur = s.id; });
  $$(".nav-link").forEach((a) => a.classList.toggle("active", a.getAttribute("href") === "#" + cur));
}
addEventListener("scroll", onScroll, { passive: true });
onScroll();

/* ---------------- tilt on hero card ---------------- */
$$(".tilt").forEach((card) => {
  const wrap = card.parentElement;
  wrap.addEventListener("mousemove", (e) => {
    const r = wrap.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
    card.style.transform = `perspective(900px) rotateY(${x * 10}deg) rotateX(${-y * 10}deg)`;
  });
  wrap.addEventListener("mouseleave", () => (card.style.transform = ""));
});

/* ---------------- ripple on primary buttons ---------------- */
document.addEventListener("pointerdown", (e) => {
  const b = e.target.closest(".btn-primary");
  if (!b || b.disabled) return;
  const r = b.getBoundingClientRect(), s = Math.max(r.width, r.height);
  const span = document.createElement("span");
  span.className = "ripple";
  Object.assign(span.style, { width: s + "px", height: s + "px", left: e.clientX - r.left - s / 2 + "px", top: e.clientY - r.top - s / 2 + "px" });
  b.appendChild(span); setTimeout(() => span.remove(), 700);
});

/* ---------------- segmented controls ---------------- */
function placePill(seg) {
  const act = $("button.active", seg), pill = $(".seg-pill", seg);
  if (!act || !pill) return;
  pill.style.width = act.offsetWidth + "px";
  pill.style.transform = `translateX(${act.offsetLeft - 4}px)`;
}
$$(".seg").forEach((seg) => {
  placePill(seg);
  seg.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || b.classList.contains("active")) return;
    $$("button", seg).forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    placePill(seg);
    onSeg(seg.dataset.name, b.dataset.value);
  });
});
addEventListener("resize", () => $$(".seg").forEach(placePill));
document.fonts?.ready.then(() => $$(".seg").forEach(placePill));

function onSeg(name, value) {
  state[name] = value;
  if (name === "xaitab") renderXai();
  if (name === "limemode") renderXai();
  if (name === "perfmodel") renderPerf();
  if (name === "curve") renderChart();
}

/* ---------------- upload ---------------- */
const dz = $("#dropzone"), fileInput = $("#fileInput");
function setFile(file, name) {
  state.file = file; state.fileName = name || file.name;
  $("#dzIdle").classList.add("hidden");
  $("#dzPreview").classList.remove("hidden"); $("#dzPreview").classList.add("flex");
  $("#dzThumb").src = URL.createObjectURL(file);
  $("#dzName").textContent = state.fileName;
  // replay the check animation
  const chk = $("#dzPreview svg"); chk.classList.remove("pop-in"); void chk.offsetWidth; chk.classList.add("pop-in");
  $("#analyzeBtn").disabled = false;
}
fileInput.addEventListener("change", () => {
  if (fileInput.files[0]) { $$(".sample").forEach((s) => s.classList.remove("active")); setFile(fileInput.files[0]); }
});
["dragenter", "dragover"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("drag"); }));
["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("drag"); }));
dz.addEventListener("drop", (e) => {
  const f = e.dataTransfer.files[0];
  if (f && f.type.startsWith("image/")) { $$(".sample").forEach((s) => s.classList.remove("active")); setFile(f); }
  else toast("Please drop an image file.");
});
$$(".sample").forEach((btn) => btn.addEventListener("click", async () => {
  $$(".sample").forEach((s) => s.classList.remove("active"));
  btn.classList.add("active");
  const blob = await (await fetch(btn.dataset.src)).blob();
  setFile(new File([blob], btn.dataset.name + ".png", { type: "image/png" }), btn.dataset.name);
}));

/* ---------------- analyze ---------------- */
$("#analyzeBtn").addEventListener("click", analyze);

async function analyze() {
  if (!state.file) return;
  const btn = $("#analyzeBtn");
  btn.disabled = true; $(".btn-label", btn).textContent = "Analyzing…";

  // result panel -> loading
  $("#resIdle").classList.add("hidden");
  const act = $("#resActive"); act.classList.remove("hidden"); act.classList.add("flex");
  $("#resImg").src = URL.createObjectURL(state.file);
  $("#scanFx").classList.remove("hidden");
  $("#resLoading").classList.remove("hidden");
  $("#resOut").classList.add("hidden");
  $("#toXai").classList.add("hidden");
  if (innerWidth < 1024) $("#resActive").scrollIntoView({ behavior: "smooth", block: "center" });

  const fd = new FormData();
  fd.append("image", state.file, state.fileName.endsWith(".png") ? state.fileName : state.file.name);
  fd.append("model", state.model);
  fd.append("threshold", state.threshold);

  try {
    const [res] = await Promise.all([fetch("/api/predict", { method: "POST", body: fd }).then((r) => r.json()), sleep(1300)]);
    if (res.error) throw new Error(res.error);
    showResult(res);
    startExplanations(res);
  } catch (err) {
    toast(err.message || "Something went wrong.");
    $("#resActive").classList.add("hidden"); $("#resIdle").classList.remove("hidden");
  } finally {
    btn.disabled = false; $(".btn-label", btn).textContent = "Run diagnosis";
  }
}

function showResult(r) {
  $("#scanFx").classList.add("hidden");
  $("#resLoading").classList.add("hidden");
  $("#resImg").src = r.image;
  const out = $("#resOut");
  out.classList.remove("hidden"); out.classList.remove("fade-up"); void out.offsetWidth; out.classList.add("fade-up");

  const pos = r.label === "PNEUMONIA";
  const color = pos ? "#fb7185" : "#34d399";
  const g = $("#gauge");
  g.style.stroke = color; g.style.color = color;
  g.style.strokeDashoffset = 326.7;
  requestAnimationFrame(() => requestAnimationFrame(() => (g.style.strokeDashoffset = 326.7 * (1 - r.probability))));
  countUp($("#gaugeVal"), r.probability * 100, 1, 1600);

  const badge = $("#resBadge");
  badge.className = "badge " + (pos ? "pos" : "neg");
  badge.textContent = r.label;
  const conf = (r.confidence * 100).toFixed(1);
  $("#resText").textContent = pos
    ? `The model sees patterns consistent with pneumonia with ${conf}% confidence. Check the explanation below to confirm it focused on the lung fields.`
    : `No pneumonia pattern detected; the model is ${conf}% confident this X-ray is normal. The explanation shows which regions it relied on.`;
  $("#resModel").textContent = r.model;
  $("#resThr").textContent = "threshold " + r.threshold;
  $("#resLat").textContent = r.latency_ms + " ms";
  const to = $("#toXai"); to.classList.remove("hidden"); to.classList.add("inline-flex", "fade-up");
}

/* ---------------- explanations ---------------- */
async function startExplanations(r) {
  state.session = r.id; state.image = r.image; state.lime = null; state.shap = null; state.prob = r.probability;
  const sec = $("#xai");
  sec.classList.remove("hidden");
  observeReveals(sec);
  requestAnimationFrame(() => $$(".seg", sec).forEach(placePill));
  resetAgreement();
  renderXai();

  const call = (m) => fetch("/api/explain/" + m, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: r.id, preset: state.preset }),
  }).then((x) => x.json());

  const sid = r.id;
  const lp = call("lime").then((d) => { if (sid !== state.session) return; if (d.error) throw new Error(d.error); state.lime = d; renderXai(); });
  const sp = call("shap").then((d) => { if (sid !== state.session) return; if (d.error) throw new Error(d.error); state.shap = d; renderXai(); });
  try {
    await Promise.all([lp, sp]);
    if (sid !== state.session) return;
    const ag = await fetch("/api/agreement/" + sid).then((x) => x.json());
    if (!ag.error) showAgreement(ag);
  } catch (e) { toast(e.message || "Explanation failed."); }
}

const COPY = {
  lime: {
    title: "LIME · Local surrogate",
    desc: "The X-ray is split into ~60 superpixels. LIME switches random groups of them off, watches how P(pneumonia) moves, and fits a simple linear model. Each region's weight is how much it pushed the decision.",
    legend: [["#10b981", "Supports PNEUMONIA"], ["#f43f5e", "Supports NORMAL"]],
  },
  shap: {
    title: "SHAP · Shapley attribution",
    desc: "SHAP treats image regions as players in a game and shares the model's output fairly between them (Partition explainer, in log-odds). Hidden regions are blacked out. Red regions raise the pneumonia score, blue regions lower it.",
    legend: [["#dc2626", "Raises P(pneumonia)"], ["#2563eb", "Lowers P(pneumonia)"]],
  },
};

function renderXai() {
  const tab = state.xaitab;
  const both = tab === "both";
  $("#xaiSingle").classList.toggle("hidden", both);
  $("#xaiBoth").classList.toggle("hidden", !both);
  if (both) return renderBoth();

  const data = state[tab];
  const c = COPY[tab];
  $("#xTitle").textContent = c.title;
  $("#xDesc").textContent = c.desc;
  $("#legend").innerHTML = c.legend.map(([col, t]) => `<span class="legend-dot"><i style="background:${col}"></i>${t}</span>`).join("");
  $("#limeModeWrap").style.visibility = tab === "lime" ? "visible" : "hidden";

  $("#vBase").src = state.image;
  const ld = $("#vLoading");
  if (!data) {
    ld.classList.remove("hidden");
    $("#vLoadingText").textContent = `Computing ${tab.toUpperCase()} explanation…`;
    $("#vOverlay").style.opacity = 0;
    $("#xDetail").innerHTML = skeleton();
    $("#xStats").innerHTML = "";
    return;
  }
  ld.classList.add("hidden");

  const ov = $("#vOverlay");
  let src = data.overlay;
  if (tab === "lime" && state.limemode === "outline") src = data.boundaries;
  if (ov.dataset.src !== src) {
    ov.style.opacity = 0;
    setTimeout(() => { ov.src = src; ov.dataset.src = src; applyOpacity(); }, 180);
    hintHandle();
  } else applyOpacity();

  if (tab === "lime") {
    const max = Math.max(...data.top_segments.map((s) => Math.abs(s.weight)), 1e-6);
    $("#xDetail").innerHTML = `<p class="label">Most influential superpixels</p>` + data.top_segments.map((s) => {
      const w = (Math.abs(s.weight) / max) * 50, pos = s.weight > 0;
      return `<div class="wbar"><span class="text-slate-400 font-mono">#${s.id}</span>
        <div class="track"><div class="fill" data-w="${w}" style="${pos ? "left:50%" : "right:50%"};background:${pos ? "linear-gradient(90deg,#10b981,#5eead4)" : "linear-gradient(270deg,#f43f5e,#fb7185)"}"></div></div>
        <span class="font-mono text-right ${pos ? "text-emerald-300" : "text-rose-300"}">${s.weight > 0 ? "+" : ""}${s.weight.toFixed(3)}</span></div>`;
    }).join("");
    $("#xStats").innerHTML = stat("Perturbations", data.n_samples) + stat("Surrogate R²", data.score.toFixed(2)) + stat("Superpixels", data.n_segments) + stat("Time", data.seconds + " s");
  } else {
    const p = data.positive_mass, n = Math.abs(data.negative_mass), tot = p + n || 1;
    $("#xDetail").innerHTML = `<p class="label">Evidence balance</p>
      <div class="shapbar"><div data-w="${(p / tot) * 100}" style="background:linear-gradient(90deg,#ef4444,#fb7185)"></div><div data-w="${(n / tot) * 100}" style="background:linear-gradient(90deg,#60a5fa,#2563eb)"></div></div>
      <div class="mt-2 flex justify-between text-xs"><span class="text-rose-300">For pneumonia ${((p / tot) * 100).toFixed(0)}%</span><span class="text-blue-300">Against ${((n / tot) * 100).toFixed(0)}%</span></div>
      <p class="mt-5 text-sm text-slate-400 leading-relaxed">With every region hidden the model outputs <span class="font-mono text-slate-200">${(data.base_value * 100).toFixed(1)}%</span> (log-odds ${data.base_logit.toFixed(2)}). The red and blue attributions move that to log-odds <span class="font-mono text-slate-200">${data.out_logit.toFixed(2)}</span>, which is the final prediction of <span class="font-mono text-slate-200">${(state.prob * 100).toFixed(1)}%</span>.</p>`;
    $("#xStats").innerHTML = stat("Model evaluations", data.max_evals) + stat("Baseline", (data.base_value * 100).toFixed(1) + "%") + stat("Baseline mask", "black") + stat("Time", data.seconds + " s");
  }
  requestAnimationFrame(() => requestAnimationFrame(() => $$("[data-w]", $("#xDetail")).forEach((b) => (b.style.width = b.dataset.w + "%"))));
}
const stat = (k, v) => `<div class="stat fade-up"><p>${k}</p><p>${v}</p></div>`;
const skeleton = () => `<div class="space-y-3">${[80, 62, 90, 48, 70].map((w) => `<div class="h-3 rounded-full bg-white/5 animate-pulse" style="width:${w}%"></div>`).join("")}</div>`;

function renderBoth() {
  $("#tOrig").src = state.image;
  $("#tLimeB").src = state.image; $("#tShapB").src = state.image;
  $("#tLime").src = state.lime ? state.lime.overlay : "";
  $("#tShap").src = state.shap ? state.shap.overlay : "";
  $("#tLime").style.visibility = state.lime ? "visible" : "hidden";
  $("#tShap").style.visibility = state.shap ? "visible" : "hidden";
  $$(".tri").forEach((t, i) => { t.classList.remove("stagger"); void t.offsetWidth; t.style.animationDelay = i * 0.12 + "s"; t.classList.add("stagger"); });
}

/* opacity + wipe handle */
const opacity = $("#opacity");
function applyOpacity() {
  const v = +opacity.value;
  opacity.style.setProperty("--v", v + "%");
  $("#opVal").textContent = v + "%";
  $("#vOverlay").style.opacity = v / 100;
}
opacity.addEventListener("input", applyOpacity);

const viewer = $("#viewer"), handle = $("#vHandle"), wrap = $("#vOverlayWrap");
function setWipe(pct) {
  pct = Math.max(0, Math.min(100, pct));
  handle.style.left = pct + "%";
  wrap.style.clipPath = `inset(0 ${100 - pct}% 0 0)`;
}
let dragging = false;
viewer.addEventListener("pointerdown", (e) => { dragging = true; viewer.setPointerCapture(e.pointerId); move(e); });
viewer.addEventListener("pointermove", (e) => dragging && move(e));
viewer.addEventListener("pointerup", () => (dragging = false));
function move(e) { const r = viewer.getBoundingClientRect(); handle.classList.remove("hint"); setWipe(((e.clientX - r.left) / r.width) * 100); }
let hinted = false;
function hintHandle() {
  if (hinted) return; hinted = true;
  // animate a gentle wipe once so people discover the handle
  const t0 = performance.now();
  const frame = (now) => {
    const p = Math.min(1, (now - t0) / 2200);
    const v = p < 0.45 ? 100 - ease(p / 0.45) * 65 : 35 + ease((p - 0.45) / 0.55) * 65;
    setWipe(v);
    if (p < 1 && !dragging) requestAnimationFrame(frame);
  };
  setTimeout(() => requestAnimationFrame(frame), 500);
}
setWipe(100);

/* agreement rings */
function resetAgreement() {
  $$(".ring-mini").forEach((r) => { $(".fg", r).style.strokeDashoffset = 207.3; $("b", r).textContent = "…"; });
}
function showAgreement(a) {
  const set = (id, val, frac) => {
    const r = $(id);
    $(".fg", r).style.strokeDashoffset = 207.3 * (1 - Math.max(0, Math.min(1, frac)));
    countUp($("b", r), val, 2, 1300);
  };
  set("#agRho", a.spearman, (a.spearman + 1) / 2);
  set("#agIou", a.iou_top20, a.iou_top20);
}

/* ---------------- performance ---------------- */
const METRIC_KEYS = [
  ["Accuracy", "Accuracy"], ["Recall", "Recall (sensitivity)"], ["Specificity", "Specificity"], ["Precision", "Precision"],
  ["F1", "F1-score"], ["ROC_AUC", "ROC-AUC"], ["PR_AUC", "PR-AUC"], ["Brier", "Brier score ↓"],
];

async function loadMetrics() {
  try {
    state.metrics = await fetch("/api/metrics").then((r) => r.json());
  } catch { return; }
  const m = state.metrics;
  $("#testN").textContent = m.splits.test;
  $("#projRho").textContent = m.xai.spearman.toFixed(2);
  $("#projIou").textContent = m.xai.iou.toFixed(2);
  $("#metricCards").innerHTML = METRIC_KEYS.map(([k, label], i) =>
    `<div class="metric reveal" style="--d:${i * 0.05}s" data-k="${k}"><p class="k">${label}</p><p class="v">0</p><div class="bar"><i></i></div></div>`).join("");
  const perf = $("#performance");
  const once = new IntersectionObserver((es) => {
    if (es.some((e) => e.isIntersecting)) { once.disconnect(); renderPerf(); renderChart(); }
  }, { threshold: 0.2 });
  once.observe(perf);
  observeReveals(perf);
  buildGallery();
}

function renderPerf() {
  const t = state.metrics.metrics[state.perfmodel].test;
  $$("#metricCards .metric").forEach((c) => {
    const k = c.dataset.k, v = t[k];
    const pct = k === "Brier" ? v : v * 100;
    countUp($(".v", c), pct, k === "Brier" ? 3 : 1, 1200, k === "Brier" ? "" : "%");
    const bar = $(".bar i", c);
    bar.style.width = "0";
    requestAnimationFrame(() => requestAnimationFrame(() => (bar.style.width = (k === "Brier" ? (1 - v * 5) * 100 : v * 100) + "%")));
  });
  const cells = [
    ["", "Pred. Normal", "Pred. Pneumonia"],
    ["Normal", t.TN, t.FP],
    ["Pneumonia", t.FN, t.TP],
  ];
  const maxv = Math.max(t.TN, t.FP, t.FN, t.TP);
  let html = "", n = 0;
  cells.forEach((row, i) => row.forEach((c, j) => {
    if (i === 0 || j === 0) { html += `<div class="cm-lab ${i === 0 && j === 0 ? "" : "py-2"}">${c}</div>`; return; }
    const good = i === j, a = 0.12 + 0.6 * (c / maxv);
    const bg = good ? `rgba(20,184,166,${a})` : `rgba(244,63,94,${Math.min(0.55, 0.18 + 3 * (c / maxv))})`;
    const lab = i === 1 ? (j === 1 ? "TN" : "FP") : (j === 1 ? "FN" : "TP");
    html += `<div class="cm-cell popin" style="background:${bg};animation-delay:${n++ * 0.08}s"><b data-n="${c}">0</b><small>${lab}</small></div>`;
  }));
  $("#cm").innerHTML = html;
  $$("#cm b").forEach((b) => countUp(b, +b.dataset.n, 0, 1000));
}

function renderChart() {
  if (!window.Chart || !state.metrics) return;
  const h = state.metrics.curves[state.perfmodel];
  const k = state.curve;
  const tr = h[k], va = h["val_" + k];
  const labels = tr.map((_, i) => i + 1);
  const ctx = $("#curveChart");
  const grad = (c1) => {
    const g = ctx.getContext("2d").createLinearGradient(0, 0, 0, 260);
    g.addColorStop(0, c1); g.addColorStop(1, "rgba(0,0,0,0)"); return g;
  };
  const data = {
    labels,
    datasets: [
      { label: "Train", data: tr, borderColor: "#2dd4bf", backgroundColor: grad("rgba(45,212,191,.25)"), fill: true, tension: 0.35, borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 5 },
      { label: "Validation", data: va, borderColor: "#a78bfa", backgroundColor: grad("rgba(167,139,250,.12)"), fill: true, tension: 0.35, borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 5, borderDash: [6, 4] },
    ],
  };
  if (state.chart) { state.chart.data = data; state.chart.update(); return; }
  Chart.defaults.color = "#64748b";
  Chart.defaults.font.family = '"Plus Jakarta Sans", sans-serif';
  state.chart = new Chart(ctx, {
    type: "line", data,
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 1400, easing: "easeOutQuart" },
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "top", align: "end", labels: { usePointStyle: true, boxWidth: 8, color: "#94a3b8" } },
        tooltip: { backgroundColor: "#111829", borderColor: "rgba(255,255,255,.1)", borderWidth: 1, padding: 10, titleColor: "#fff", bodyColor: "#cbd5e1", callbacks: { title: (i) => "Epoch " + i[0].label, label: (i) => ` ${i.dataset.label}: ${i.parsed.y.toFixed(4)}` } },
      },
      scales: {
        x: { grid: { color: "rgba(255,255,255,.03)" }, title: { display: true, text: "Epoch" } },
        y: { grid: { color: "rgba(255,255,255,.05)" } },
      },
    },
  });
}

/* ---------------- gallery ---------------- */
const SHOTS = [
  ["01_class_distribution", "Class distribution", "Pneumonia vs normal counts"],
  ["03_sample_images", "Sample images", "Examples from both classes"],
  ["09_preprocessing_example", "Preprocessing", "Resize and normalisation"],
  ["10_augmentation_examples", "Augmentation", "Training-time transforms"],
  ["13_confusion_matrices_test", "Confusion matrices", "Both models, test split"],
  ["15_roc_pr_calibration", "ROC · PR · calibration", "Ranking and reliability"],
  ["19_threshold_analysis", "Threshold analysis", "0.5 vs Youden's J"],
  ["22_lime_explanations", "LIME explanations", "TP, TN, FP and FN cases"],
  ["24_shap_explanations", "SHAP explanations", "Partition explainer"],
  ["26_lime_vs_shap_comparison", "LIME vs SHAP", "Same images, two methods"],
  ["27_agreement_metrics", "Agreement metrics", "Spearman ρ and IoU"],
];
function buildGallery() {
  const strip = $("#strip");
  strip.innerHTML = SHOTS.map(([f, t, s]) =>
    `<figure class="shot" data-src="${STATIC}plots/${f}.png" data-cap="${t}"><div class="im"><img loading="lazy" src="${STATIC}plots/${f}.png" alt="${t}"></div><p>${t}<small>${s}</small></p></figure>`).join("");
  strip.addEventListener("click", (e) => {
    const s = e.target.closest(".shot"); if (!s) return;
    $("#lbImg").src = s.dataset.src; $("#lbCap").textContent = s.dataset.cap;
    $("#lightbox").classList.add("open");
  });
  $$("[data-scroll]").forEach((b) => b.addEventListener("click", () => strip.scrollBy({ left: +b.dataset.scroll * 420, behavior: "smooth" })));
}
const closeLb = () => $("#lightbox").classList.remove("open");
$("#lbClose").addEventListener("click", closeLb);
$("#lightbox").addEventListener("click", (e) => { if (e.target.id === "lightbox") closeLb(); });
addEventListener("keydown", (e) => e.key === "Escape" && closeLb());

loadMetrics();
