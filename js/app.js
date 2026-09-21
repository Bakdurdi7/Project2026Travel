/* ============================================================
   Sayohat Kuzatuvchi — app.js (to'liq ishchi versiya)
   ============================================================ */

/* ---------- 1. SUPABASE (ixtiyoriy) ---------- */
/* Bu yerga o'z loyihangiz URL va anon key'ini qo'ying.
   Sozlamasangiz ham ilova to'liq ishlaydi — faqat "Bazaga saqlash"
   tugmasi xabar ko'rsatadi. */
const SUPABASE_URL = "https://fexyihehnafbbjqcbehe.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZleHlpaGVobmFmYmJqcWNiZWhlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk5ODgxMDQsImV4cCI6MjEwNTU2NDEwNH0.cqs-dT64rVoADQAWtBVg-b-Otl9cHQ0dKTf5IVHq3VI";

let sb = null;
try {
    const configured =
        SUPABASE_URL.startsWith("https://") &&
        !SUPABASE_URL.includes("SIZNING") &&
        window.supabase;
    if (configured) sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} catch (e) {
    console.warn("Supabase ulanmadi:", e);
}

/* ---------- 2. DOM ---------- */
const $ = (id) => document.getElementById(id);
const statusLine  = $("statusLine");
const outDistance = $("outDistance");
const outTime     = $("outTime");
const outSpeed    = $("outSpeed");
const outSteps    = $("outSteps");
const btnStart    = $("btnStart");
const btnStop     = $("btnStop");
const btnReset    = $("btnReset");
const weightInput = $("weightInput");
const modal       = $("modal");
const modalBox    = $("modalBox");
const resultGrid  = $("resultGrid");
const saveMsg     = $("saveMsg");

function setStatus(txt) { statusLine.textContent = txt; }

/* ---------- 3. Leaflet tekshiruvi ---------- */
if (typeof L === "undefined") {
    setStatus("❌ Xarita kutubxonasi (Leaflet) yuklanmadi. Internetni tekshiring.");
    throw new Error("Leaflet yuklanmagan");
}

/* ---------- 4. XARITA ---------- */
const map = L.map("map").setView([41.311081, 69.240562], 13);

L.tileLayer("[{s}.tile.openstreetmap.org](https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png)", {
    maxZoom: 19,
    attribution: "© OpenStreetMap hissadorlari",
}).addTo(map);

/* Qatlamlar */
let trackLine = null;
let meMarker = null;
let startMarker = null;

/* ---------- 5. HOLAT ---------- */
let watchId = null;
let tracking = false;
let points = [];
let totalMeters = 0;
let startTime = null;
let timerInterval = null;
let stepCount = 0;
let lastMetrics = null;

/* ---------- 6. YORDAMCHI FUNKSIYALAR ---------- */
function haversine(a, b) {
    const R = 6371000;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 +
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

/* ---------- 7. JOYLASHUVNI OLISH ---------- */
function initLocation() {
    if (!navigator.geolocation) {
        setStatus("Brauzeringiz geolokatsiyani qo'llab-quvvatlamaydi.");
        return;
    }
    setStatus("Joylashuv aniqlanmoqda... (ruxsat so'raladi)");

    navigator.geolocation.getCurrentPosition(
        (pos) => {
            const { latitude: lat, longitude: lng, accuracy } = pos.coords;
            map.setView([lat, lng], 17);

            if (meMarker) map.removeLayer(meMarker);
            meMarker = L.marker([lat, lng]).addTo(map)
                .bindPopup("📍 Siz shu yerdasiz<br>Aniqlik: ±" + Math.round(accuracy) + " m")
                .openPopup();

            setStatus(`✅ Joylashuv aniqlandi (±${Math.round(accuracy)} m). Boshlash mumkin.`);
            btnStart.disabled = false;
        },
        (err) => {
            let msg;
            switch (err.code) {
                case err.PERMISSION_DENIED:
                    msg = "❌ Joylashuvga ruxsat berilmadi. Manzil satridagi 🔒 belgisidan 'Allow' tanlang va sahifani yangilang.";
                    break;
                case err.POSITION_UNAVAILABLE:
                    msg = "⚠️ Joylashuv mavjud emas. GPS / Windows Location xizmatini yoqing.";
                    break;
                case err.TIMEOUT:
                    msg = "⏱ Joylashuv so'rovi vaqti tugadi. Qayta urinib ko'ring.";
                    break;
                default:
                    msg = "Joylashuv xatosi: " + err.message;
            }
            setStatus(msg);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
}

/* ---------- 8. YURISHNI BOSHLASH ---------- */
function startTracking() {
    if (tracking) return;
    if (!navigator.geolocation) { setStatus("Geolokatsiya yo'q."); return; }

    tracking = true;
    points = [];
    totalMeters = 0;
    stepCount = 0;
    startTime = Date.now();

    /* Tugmalar holati */
    btnStart.disabled = true;
    btnStop.disabled = false;
    btnReset.disabled = true;
    setStatus("🟢 Yurish kuzatilmoqda... Yuring!");

    /* Eski qatlamlarni tozalash */
    if (trackLine) map.removeLayer(trackLine);
    if (startMarker) map.removeLayer(startMarker);

    trackLine = L.polyline([], { color: "#22c55e", weight: 5, opacity: 0.9 }).addTo(map);

    /* Vaqt taymeri */
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

/* ---------- 9. HAR YANGI NUQTADA ---------- */
function onPosition(pos) {
    if (!tracking) return;
    const { latitude: lat, longitude: lng } = pos.coords;
    const now = Date.now();
    const newPt = { lat, lng, t: now };
    const last = points[points.length - 1];

    if (last) {
        const d = haversine(last, newPt);
        if (d < 3) return;                 // GPS shovqinini filtrlash
        totalMeters += d;
        stepCount = Math.round(totalMeters / 0.75);  // o'rtacha qadam ~0.75 m
    }
    points.push(newPt);

    const latlng = [lat, lng];
    if (!trackLine) trackLine = L.polyline([], { color: "#22c55e", weight: 5 }).addTo(map);
    trackLine.addLatLng(latlng);

    if (!meMarker) meMarker = L.marker(latlng).addTo(map);
    else meMarker.setLatLng(latlng);

    if (!startMarker && points.length === 1) {
        startMarker = L.circleMarker(latlng, {
            radius: 7, color: "#16a34a", fillColor: "#22c55e", fillOpacity: 1,
        }).addTo(map).bindPopup("🟢 Boshlanish nuqtasi");
    }
    map.panTo(latlng);

    const sec = (now - startTime) / 1000 || 1;
    const speedKmh = (totalMeters / 1000) / (sec / 3600);
    outDistance.textContent = fmtDistance(totalMeters);
    outSpeed.textContent = speedKmh.toFixed(1) + " km/s";
    outSteps.textContent = stepCount.toLocaleString("uz-UZ");
}

/* ---------- 10. HISOBIY METRIKALAR ---------- */
function metForSpeed(kmh) {
    if (kmh < 3.2) return 2.8;
    if (kmh < 4.8) return 3.5;
    if (kmh < 6.4) return 5.0;
    if (kmh < 8.0) return 7.0;
    return 8.3;
}

function computeMetrics() {
    const seconds = (Date.now() - startTime) / 1000;
    const hours = seconds / 3600;
    const weight = parseFloat(weightInput.value) || 70;
    const kmh = hours > 0 ? (totalMeters / 1000) / hours : 0;
    const met = metForSpeed(kmh);
    const kcal = met * weight * hours;             // kcal = MET × kg × soat
    const fatGrams = (kcal / 7700) * 1000;         // 1 kg yog' ≈ 7700 kcal

    return {
        seconds, kmh, met,
        kcal: Math.round(kcal),
        fatGrams: Math.round(fatGrams * 10) / 10,
        weight, meters: totalMeters, steps: stepCount,
    };
}

function heartBenefit(kmh, minutes) {
    const lines = [];
    if (minutes < 5) {
        lines.push("Qisqa yurish ham qon aylanishini jonlantiradi — davom eting!");
    } else {
        lines.push("Yurak-qon tomir tizimi chidamliligi oshadi.");
    }
    if (kmh >= 4.8) {
        lines.push("Tez yurish yurak urish tezligini foydali zonaga olib chiqadi.");
        lines.push("Qon bosimini me'yorlashtirishga va xolesterinni kamaytirishga yordam beradi.");
    } else {
        lines.push("Tinch sur'atda yurish ham yurak uchun xavfsiz va foydali yuklama.");
        lines.push("Kunlik 30 daqiqa yurish yurak kasalliklari xavfini kamaytiradi.");
    }
    return lines;
}

/* ---------- 11. YURISHNI TUGATISH ---------- */
function stopTracking() {
    if (!tracking) return;
    tracking = false;

    if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
    clearInterval(timerInterval);
    timerInterval = null;

    btnStart.disabled = false;
    btnStop.disabled = true;
    btnReset.disabled = false;
    setStatus("🔴 Yurish tugatildi. Natija tayyor.");

    const m = computeMetrics();
    showResult(m);
}

/* ---------- 12. NATIJANI KO'RSATISH ---------- */
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
    <div class="result-card" style="grid-column:1/-1;">
      <div class="r-label">❤️ Yurak uchun foyda</div>
      <div class="r-note" style="font-size:0.85rem;line-height:1.6;margin-top:6px;">
        ${benefitLines.map((l) => "• " + l).join("<br>")}
      </div>
    </div>
  `;

    drawShareCard(m, benefitLines);
    saveMsg.textContent = "";
    modal.classList.add("is-open");     // ✅ sinf bilan ochish
}

/* ---------- 13. RASMGA CHIZISH ---------- */
function drawShareCard(m, benefitLines) {
    const c = $("shareCanvas");
    const ctx = c.getContext("2d");
    const W = c.width, H = c.height;

    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "#0f172a");
    grad.addColorStop(1, "#1e293b");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = "#22c55e";
    ctx.font = "bold 54px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("🚶 Yurish natijasi", W / 2, 110);

    ctx.fillStyle = "#94a3b8";
    ctx.font = "32px system-ui, sans-serif";
    ctx.fillText(new Date().toLocaleDateString("uz-UZ"), W / 2, 165);

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
    const y0 = 230;

    cards.forEach((item, i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const x = startX + col * (cardW + gap);
        const cy = y0 + row * (cardH + gap);

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

    const by = y0 + 3 * (cardH + gap) + 10;
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

/* ---------- 14. RASMNI YUKLAB OLISH ---------- */
$("btnDownload").addEventListener("click", () => {
    const c = $("shareCanvas");
    const a = document.createElement("a");
    a.download = `yurish-${new Date().toISOString().slice(0, 10)}.png`;
    a.href = c.toDataURL("image/png");
    a.click();
});

/* ---------- 15. SUPABASE'GA SAQLASH ---------- */
async function saveToDatabase() {
    if (!sb) {
        saveMsg.textContent = "⚠️ Supabase sozlanmagan (app.js'da URL va KEY kiriting).";
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
        route: points,
    };

    saveMsg.textContent = "Saqlanmoqda...";
    const { error } = await sb.from("walks").insert(row);
    saveMsg.textContent = error ? "❌ Xatolik: " + error.message : "✅ Ma'lumot bazaga saqlandi.";
}

/* ---------- 16. TUGMALAR ---------- */
btnStart.addEventListener("click", startTracking);
btnStop.addEventListener("click", stopTracking);

btnReset.addEventListener("click", () => {
    if (tracking) return;
    points = []; totalMeters = 0; stepCount = 0;
    if (trackLine) { map.removeLayer(trackLine); trackLine = null; }
    if (startMarker) { map.removeLayer(startMarker); startMarker = null; }
    outDistance.textContent = "0 m";
    outTime.textContent = "00:00";
    outSpeed.textContent = "0.0 km/s";
    outSteps.textContent = "0";
    setStatus("Tozalandi. Boshlash mumkin.");
});

$("btnClose").addEventListener("click", () => modal.classList.remove("is-open"));

/* Backdrop'ni bosganda ham yopiladi (modalBox ichini bosganda emas) */
modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.classList.remove("is-open");
});

/* ESC tugmasi bilan yopish */
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") modal.classList.remove("is-open");
});

$("btnSave").addEventListener("click", saveToDatabase);

/* ---------- 17. ISHGA TUSHIRISH ---------- */
initLocation();
