/* ============================================================
   Sayohat Kuzatuvchi — app.js
   ============================================================ */

/* ---------- 1. SUPABASE SOZLAMALARI ---------- */
const SUPABASE_URL = "https://rcuiyqzgyyidqkqnphou.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJjdWl5cXpneXlpZHFrcW5waG91Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk5Nzc4NDgsImV4cCI6MjEwNTU1Mzg0OH0.VGK8nnDxwfnxS8culreffDPJ20Xyg9gf9zZW8mvlgp0";

const supabaseClient =
    window.supabase && SUPABASE_URL.startsWith("https")
        ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
        : null;

/* ---------- 2. DOM ---------- */
const el = (id) => document.getElementById(id);
const statusLine = el("statusLine");
const outDistance = el("outDistance");
const outTime     = el("outTime");
const outSpeed    = el("outSpeed");
const outSteps    = el("outSteps");
const btnStart    = el("btnStart");
const btnStop     = el("btnStop");
const btnReset    = el("btnReset");
const weightInput = el("weightInput");
const modal       = el("modal");
const resultGrid  = el("resultGrid");
const saveMsg     = el("saveMsg");

/* ---------- 3. XARITA ---------- */
const map = L.map("map", { zoomControl: true }).setView([41.311081, 69.240562], 15);

L.tileLayer("[{s}.tile.openstreetmap.org](https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png)", {
    maxZoom: 19,
    attribution: "© OpenStreetMap hissadorlari",
}).addTo(map);

/* Qatlamlar */
let trackLine   = null;   // yurilgan yo'l chizig'i
let meMarker    = null;   // hozirgi joylashuv
let startMarker = null;

/* ---------- 4. HOLAT (STATE) ---------- */
let watchId = null;
let tracking = false;
let points = [];          // { lat, lng, t }
let totalMeters = 0;
let startTime = null;
let timerInterval = null;
let stepCount = 0;

/* ---------- 5. YORDAMCHI FUNKSIYALAR ---------- */

/* Haversine — ikki nuqta orasidagi masofa (metr) */
function haversine(a, b) {
    const R = 6371000;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
}

function fmtDistance(m) {
    return m >= 1000 ? (m / 1000).toFixed(2) + " km" : Math.round(m) + " m";
}

function fmtTime(sec) {
    const m = String(Math.floor(sec / 60)).padStart(2, "0");
    const s = String(Math.floor(sec % 60)).padStart(2, "0");
    return `${m}:${s}`;
}

function setStatus(txt) { statusLine.textContent = txt; }

/* ---------- 6. JOYLASHUVNI OLISH ---------- */
function initLocation() {
    if (!navigator.geolocation) {
        setStatus("Brauzeringiz geolokatsiyani qo'llab-quvvatlamaydi.");
        return;
    }
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            const { latitude: lat, longitude: lng, accuracy } = pos.coords;
            map.setView([lat, lng], 17);
            meMarker = L.marker([lat, lng], { title: "Siz shu yerdasiz" })
                .addTo(map)
                .bindPopup("📍 Siz shu yerdasiz<br>Aniqlik: ±" + Math.round(accuracy) + " m")
                .openPopup();
            setStatus(`Joylashuv aniqlandi (aniqlik ±${Math.round(accuracy)} m). Boshlash mumkin.`);
            btnStart.disabled = false;
        },
        (err) => {
            setStatus("Joylashuvni olib bo'lmadi: " + err.message + ". Ruxsatni tekshiring.");
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
}

/* ---------- 7. YURISHNI BOSHLASH ---------- */
function startTracking() {
    if (tracking) return;

    tracking = true;
    points = [];
    totalMeters = 0;
    stepCount = 0;
    startTime = Date.now();
    btnStart.disabled = true;
    btnStop.disabled = false;
    btnReset.disabled = true;
    setStatus("🟢 Yurish kuzatilmoqda...");

    /* chizilgan eski yo'lni tozalash */
    if (trackLine) map.removeLayer(trackLine);
    if (startMarker) map.removeLayer(startMarker);
    trackLine = L.polyline([], { color: "#22c55e", weight: 5, opacity: 0.9 }).addTo(map);

    /* vaqt taymeri */
    timerInterval = setInterval(() => {
        const sec = (Date.now() - startTime) / 1000;
        outTime.textContent = fmtTime(sec);
    }, 1000);

    /* GPS kuzatuvi */
    watchId = navigator.geolocation.watchPosition(
        onPosition,
        (err) => setStatus("GPS xatosi: " + err.message),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
}

/* ---------- 8. HAR YANGI NUQTADA ---------- */
function onPosition(pos) {
    const { latitude: lat, longitude: lng, accuracy, speed } = pos.coords;
    const now = Date.now();
    const newPt = { lat, lng, t: now };

    const last = points[points.length - 1];
    if (last) {
        const d = haversine(last, newPt);
        // 3 metrdan kichik siljishlarni (GPS shovqinini) tashlab yuboramiz
        if (d < 3) return;
        totalMeters += d;

        // Qadam taxmini: o'rtacha qadam uzunligi ~0.75 m
        stepCount = Math.round(totalMeters / 0.75);
    }

    points.push(newPt);

    /* Xaritani yangilash */
    const latlng = [lat, lng];
    trackLine.addLatLng(latlng);
    if (!meMarker) {
        meMarker = L.marker(latlng).addTo(map);
    } else {
        meMarker.setLatLng(latlng);
    }
    if (!startMarker && points.length === 1) {
        startMarker = L.circleMarker(latlng, {
            radius: 7, color: "#16a34a", fillColor: "#22c55e", fillOpacity: 1,
        }).addTo(map).bindPopup("🟢 Boshlanish nuqtasi");
    }
    map.panTo(latlng);

    /* Ko'rsatkichlar */
    const sec = (now - startTime) / 1000 || 1;
    const speedKmh = (totalMeters / 1000) / (sec / 3600);
    outDistance.textContent = fmtDistance(totalMeters);
    outSpeed.textContent = speedKmh.toFixed(1) + " km/s";
    outSteps.textContent = stepCount.toLocaleString("uz-UZ");
}

/* ---------- 9. HISOBIY METRIKALAR ---------- */
/**
 * Kaloriya: MET usuli.
 * Yurish o'rtacha tezligiga qarab MET tanlanadi.
 * kcal = MET × vazn(kg) × vaqt(soat)
 */
function metForSpeed(kmh) {
    if (kmh < 3.2) return 2.8;   // sekin yurish
    if (kmh < 4.8) return 3.5;   // o'rtacha
    if (kmh < 6.4) return 5.0;   // tez yurish
    if (kmh < 8.0) return 7.0;   // juda tez / yengil yugurish
    return 8.3;                  // yugurish
}

function computeMetrics() {
    const seconds = (Date.now() - startTime) / 1000;
    const hours = seconds / 3600;
    const weight = parseFloat(weightInput.value) || 70;
    const kmh = hours > 0 ? (totalMeters / 1000) / hours : 0;

    const met = metForSpeed(kmh);
    const kcal = met * weight * hours;

    /* Yog' massasi: ~1 kg yog' ≈ 7700 kcal */
    const fatGrams = (kcal / 7700) * 1000;

    return {
        seconds, kmh, met, kcal: Math.round(kcal),
        fatGrams: Math.round(fatGrams * 10) / 10,
        weight, meters: totalMeters, steps: stepCount,
    };
}

/* Yurak uchun foyda matni — tezlikka qarab */
function heartBenefit(kmh, minutes) {
    const lines = [];
    if (minutes < 5) {
        lines.push("Qisqa yurish ham qon aylanishini jonlantiradi — davom eting!");
    } else {
        lines.push("Yurak-qon tomir tizimi chidamliligi oshadi.");
    }
    if (kmh >= 4.8) {
        lines.push("Tez yurish yurak urish tezligini foydali zonaga olib chiqadi (yurak mashqi).");
        lines.push("Qon bosimini me'yorlashtirishga va xolesterinni kamaytirishga yordam beradi.");
    } else {
        lines.push("Tinch sur'atda yurish ham yurak uchun xavfsiz va foydali yuklama.");
        lines.push("Kunlik 30 daqiqa yurish yurak kasalliklari xavfini kamaytiradi.");
    }
    return lines;
}

/* ---------- 10. YURISHNI TUGATISH ---------- */
function stopTracking() {
    if (!tracking) return;
    tracking = false;

    if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
    clearInterval(timerInterval);
    btnStart.disabled = false;
    btnStop.disabled = true;
    btnReset.disabled = false;
    setStatus("🔴 Yurish tugatildi. Natija tayyor.");

    const m = computeMetrics();
    showResult(m);
}

/* ---------- 11. NATIJANI KO'RSATISH ---------- */
let lastMetrics = null;

function showResult(m) {
    lastMetrics = m;
    const minutes = Math.floor(m.seconds / 60);
    const benefitLines = heartBenefit(m.kmh, minutes);

    resultGrid.innerHTML = `
    <div class="result-card">
      <div class="r-label">Yurilgan masofa</div>
      <div class="r-value">${fmtDistance(m.meters)}</div>
      <div class="r-note">${m.steps.toLocaleString("uz-UZ")} qadam</div>
    </div>
    <div class="result-card">
      <div class="r-label">Vaqt</div>
      <div class="r-value">${fmtTime(m.seconds)}</div>
      <div class="r-note">O'rtacha ${m.kmh.toFixed(1)} km/s</div>
    </div>
    <div class="result-card">
      <div class="r-label">Sarflangan kaloriya</div>
      <div class="r-value">${m.kcal} kcal</div>
      <div class="r-note">MET ${m.met} · ${m.weight} kg</div>
    </div>
    <div class="result-card">
      <div class="r-label">Sarflangan yog'</div>
      <div class="r-value">${m.fatGrams} g</div>
      <div class="r-note">≈ 1 kg yog' = 7700 kcal</div>
    </div>
    <div class="result-card" style="grid-column: 1 / -1;">
      <div class="r-label">❤️ Yurak uchun foyda</div>
      <div class="r-note" style="font-size:0.85rem; line-height:1.6; margin-top:6px;">
        ${benefitLines.map((l) => "• " + l).join("<br>")}
      </div>
    </div>
  `;

    drawShareCard(m, benefitLines);
    saveMsg.textContent = "";
    modal.hidden = false;
}

/* ---------- 12. RASMGA CHIZISH (share card) ---------- */
function drawShareCard(m, benefitLines) {
    const c = el("shareCanvas");
    const ctx = c.getContext("2d");
    const W = c.width, H = c.height;

    /* Fon */
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "#0f172a");
    grad.addColorStop(1, "#1e293b");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    /* Sarlavha */
    ctx.fillStyle = "#22c55e";
    ctx.font = "bold 54px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("🚶 Yurish natijasi", W / 2, 110);

    ctx.fillStyle = "#94a3b8";
    ctx.font = "32px system-ui, sans-serif";
    ctx.fillText(new Date().toLocaleDateString("uz-UZ"), W / 2, 165);

    /* Asosiy metrikalar */
    const cards = [
        ["Masofa", fmtDistance(m.meters)],
        ["Vaqt", fmtTime(m.seconds)],
        ["Kaloriya", m.kcal + " kcal"],
        ["Sarflangan yog'", m.fatGrams + " g"],
        ["Qadamlar", m.steps.toLocaleString("uz-UZ")],
        ["O'rtacha tezlik", m.kmh.toFixed(1) + " km/s"],
    ];

    const cardW = 430, cardH = 150, gap = 30;
    const startX = (W - (cardW * 2 + gap)) / 2;
    let y = 230;

    cards.forEach((item, i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const x = startX + col * (cardW + gap);
        const cy = y + row * (cardH + gap);

        ctx.fillStyle = "#273449";
        roundRect(ctx, x, cy, cardW, cardH, 22);
        ctx.fill();

        ctx.fillStyle = "#94a3b8";
        ctx.font = "28px system-ui, sans-serif";
        ctx.textAlign = "left";
        ctx.fillText(item[0], x + 30, cy + 55);

        ctx.fillStyle = "#22c55e";
        ctx.font = "bold 52px system-ui, sans-serif";
        ctx.fillText(item[1], x + 30, cy + 118);
    });

    /* Yurak foydasi bloki */
    const by = y + 3 * (cardH + gap) + 10;
    ctx.fillStyle = "#273449";
    roundRect(ctx, startX, by, cardW * 2 + gap, 300, 22);
    ctx.fill();

    ctx.fillStyle = "#ef4444";
    ctx.font = "bold 36px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("❤️ Yurak uchun foyda", startX + 30, by + 55);

    ctx.fillStyle = "#e2e8f0";
    ctx.font = "26px system-ui, sans-serif";
    benefitLines.slice(0, 4).forEach((line, i) => {
        wrapText(ctx, "• " + line, startX + 30, by + 105 + i * 46, cardW * 2 + gap - 60, 34);
    });

    /* Pastgi imzo */
    ctx.fillStyle = "#64748b";
    ctx.font = "24px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Sayohat Kuzatuvchi bilan yaratilgan", W / 2, H - 40);
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
    const words = text.split(" ");
    let line = "";
    for (const w of words) {
        const test = line + w + " ";
        if (ctx.measureText(test).width > maxWidth && line) {
            ctx.fillText(line.trim(), x, y);
            line = w + " ";
            y += lineHeight;
        } else {
            line = test;
        }
    }
    ctx.fillText(line.trim(), x, y);
}

/* ---------- 13. RASMNI YUKLAB OLISH ---------- */
el("btnDownload").addEventListener("click", () => {
    const c = el("shareCanvas");
    const a = document.createElement("a");
    a.download = `yurish-${new Date().toISOString().slice(0, 10)}.png`;
    a.href = c.toDataURL("image/png");
    a.click();
});

/* ---------- 14. SUPABASE'GA SAQLASH ---------- */
async function saveToDatabase() {
    if (!supabaseClient) {
        saveMsg.textContent = "⚠️ Supabase sozlamalari kiritilmagan (app.js faylida URL va KEY).";
        return;
    }
    if (!lastMetrics) return;

    const m = lastMetrics;
    const row = {
        started_at: new Date(startTime).toISOString(),
        ended_at: new Date().toISOString(),
        duration_seconds: Math.round(m.seconds),
        distance_meters: Math.round(m.meters),
        steps: m.steps,
        avg_speed_kmh: Number(m.kmh.toFixed(2)),
        met: m.met,
        weight_kg: m.weight,
        calories_kcal: m.kcal,
        fat_grams: m.fatGrams,
        heart_note: heartBenefit(m.kmh, Math.floor(m.seconds / 60)).join(" "),
        route: points,            // jsonb: [{lat,lng,t}, ...]
    };

    saveMsg.textContent = "Saqlanmoqda...";

    const { error } = await supabaseClient.from("walks").insert(row);

    saveMsg.textContent = error
        ? "❌ Xatolik: " + error.message
        : "✅ Ma'lumot bazaga saqlandi.";
}

/* ---------- 15. TUGMALAR ---------- */
btnStart.addEventListener("click", startTracking);
btnStop.addEventListener("click", stopTracking);

btnReset.addEventListener("click", () => {
    if (tracking) return;
    points = [];
    totalMeters = 0;
    stepCount = 0;
    if (trackLine) { map.removeLayer(trackLine); trackLine = null; }
    if (startMarker) { map.removeLayer(startMarker); startMarker = null; }
    outDistance.textContent = "0 m";
    outTime.textContent = "00:00";
    outSpeed.textContent = "0.0 km/s";
    outSteps.textContent = "0";
    setStatus("Tozalandi. Boshlash mumkin.");
});

el("btnSave").addEventListener("click", saveToDatabase);
el("btnClose").addEventListener("click", () => { modal.hidden = true; });

/* ---------- 16. ISHGA TUSHIRISH ---------- */
btnStart.disabled = true;
initLocation();
