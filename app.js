const DAYS = ["2024-08-09", "2024-08-10", "2024-08-11", "2024-08-12", "2024-08-13", "2024-08-14"];

const map = L.map("map", { preferCanvas: true }).setView([56, -95], 4);

const trueColor = L.tileLayer(
  "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/{date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg",
  { date: "2024-08-10", maxNativeZoom: 9, maxZoom: 9, zIndex: 1, attribution: "Imagery: NASA GIBS / EOSDIS" }
);
trueColor.addTo(map);

const fires = L.tileLayer.wms("https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi", {
  layers: "VIIRS_SNPP_Thermal_Anomalies_375m_All",
  format: "image/png",
  transparent: true,
  version: "1.3.0",
  time: "2024-08-10",
  zIndex: 2
});
fires.addTo(map);

// Borders (NASA GIBS) and names of the Canadian provinces and territories
map.createPane("labels");
map.getPane("labels").style.zIndex = 250;
map.getPane("labels").style.pointerEvents = "none";

L.tileLayer.wms("https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi", {
  layers: "Reference_Features_15m",
  format: "image/png",
  transparent: true,
  version: "1.3.0",
  pane: "labels"
}).addTo(map);

const PROVINCES = [
  ["British Columbia", 55.0, -125.0], ["Alberta", 55.2, -115.5], ["Saskatchewan", 54.5, -106.0],
  ["Manitoba", 55.5, -98.0], ["Ontario", 50.5, -86.0], ["Quebec", 52.0, -72.0],
  ["Newfoundland and Labrador", 53.5, -61.5], ["New Brunswick", 46.6, -66.2],
  ["Nova Scotia", 45.0, -63.0], ["Prince Edward Island", 46.4, -63.2],
  ["Yukon", 63.5, -136.0], ["Northwest Territories", 65.5, -120.0], ["Nunavut", 67.0, -90.0]
];
for (const [name, lat, lon] of PROVINCES) {
  L.marker([lat, lon], {
    pane: "labels", interactive: false,
    icon: L.divIcon({ className: "prov-label", html: "<span>" + name + "</span>", iconSize: [0, 0] })
  }).addTo(map);
}

// Sherbrooke (CARTEL), the start of all trajectories
map.createPane("place");
map.getPane("place").style.zIndex = 620;
L.circleMarker([45.379, -71.931], {
  pane: "place", radius: 6, color: "#000", weight: 2,
  fillColor: "#fff", fillOpacity: 1
})
  .bindTooltip("Sherbrooke (CARTEL)", {
    permanent: true, direction: "right", offset: [8, 0], className: "place-label"
  })
  .addTo(map);

const clusterLayer = L.layerGroup().addTo(map);
const trajLayer = L.layerGroup().addTo(map);
const hitLayer = L.layerGroup().addTo(map);
let currentDay = "2024-08-10";

// which start heights are switched on
const ACTIVE = { "1500": true, "3000": true, "3600": true };

const sel = document.getElementById("day");
const details = document.getElementById("details");
const DEFAULT_DETAILS = details.innerHTML;
function resetDetails() { details.innerHTML = DEFAULT_DETAILS; }

// ---------- helpers ----------
function dayOf(i) {
  const t = new Date(Date.UTC(2024, 7, 14, 19) + (i - 120) * 3600 * 1000);
  return t.toISOString().slice(0, 10);
}

function whenOf(i) {
  const t = new Date(Date.UTC(2024, 7, 14, 19) + (i - 120) * 3600 * 1000);
  return t.toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

function zColor(z) {
  const stops = [[0, [13, 8, 135]], [1000, [126, 3, 168]], [2000, [204, 71, 120]],
                 [3000, [248, 149, 64]], [4500, [253, 202, 38]]];
  z = Math.max(0, Math.min(4500, z));
  for (let i = 1; i < stops.length; i++) {
    if (z <= stops[i][0]) {
      const [z0, c0] = stops[i - 1];
      const [z1, c1] = stops[i];
      const f = (z - z0) / (z1 - z0);
      const rgb = c0.map((v, k) => Math.round(v + (c1[k] - v) * f));
      return "rgb(" + rgb.join(",") + ")";
    }
  }
}

function row(label, value) {
  return "<dt>" + label + "</dt><dd>" + value + "</dd>";
}

function aboveMixed(z, mld) {
  return z > mld ? (z - mld) + " m above the mixed layer" : "inside the mixed layer";
}

// ---------- info panel ----------
function showPoint(q) {
  details.innerHTML = "<p class='big'>Trajectory point</p><dl>" +
    row("Trajectory", q.h + " m start, member " + q.m) +
    row("Time", whenOf(q.i) + " (" + (q.i - 120) + " h)") +
    row("Position", q.lat + " N, " + q.lon + " E") +
    row("Height above ground", q.z + " m") +
    row("Mixed layer depth", q.mld + " m") +
    row("Air is", aboveMixed(q.z, q.mld)) + "</dl>";
}

function showHit(r, p) {
  const [h, m, age, cday, cid, frp, dist] = r;
  details.innerHTML = "<p class='big'>Over a fire cluster</p><dl>" +
    row("Trajectory", h + " m start, member " + m) +
    row("Time", whenOf(age + 120) + " (" + age + " h)") +
    row("Height above ground", p[2] + " m") +
    row("Mixed layer depth", p[3] + " m") +
    row("Air is", aboveMixed(p[2], p[3])) +
    row("Fire cluster", "no. " + cid + " of " + cday + ", total FRP " + frp + " MW") +
    row("Distance to cluster centre", dist + " km") + "</dl>";
}

// ---------- drawing ----------
// clusters go to the back, hit dots to the front
function restack() {
  clusterLayer.eachLayer(l => l.bringToBack());
  hitLayer.eachLayer(l => l.bringToFront());
}

function drawClusters(day) {
  clusterLayer.clearLayers();
  for (const c of CLUSTERS) {
    const [d, id, n, lat, lon, frp, radiusKm] = c;
    if (d !== day) continue;
    L.circle([lat, lon], {
      radius: radiusKm * 1000,
      color: "#d7301f", weight: 1.5,
      fillColor: "#ef6548", fillOpacity: 0.25
    })
      .bindTooltip("Cluster " + id + ": " + n + " detections, total FRP " + frp + " MW, radius " + radiusKm + " km")
      .addTo(clusterLayer);
  }
  restack();
}

function drawTraj(day) {
  trajLayer.clearLayers();
  for (const h of ["1500", "3000", "3600"]) {
    if (!ACTIVE[h]) continue;
    for (const m in TRAJ[h]) {
      const P = TRAJ[h][m];
      for (let i = 0; i < P.length - 1; i++) {
        const a = P[i], b = P[i + 1];
        const line = [[a[0], a[1]], [b[0], b[1]]];
        const color = zColor((a[2] + b[2]) / 2);
        if (dayOf(i) === day) {
          L.polyline(line, { color: "#000", weight: 4.5, opacity: 0.25, interactive: false }).addTo(trajLayer);
          L.polyline(line, { color: color, weight: 2.5, opacity: 0.95, interactive: false }).addTo(trajLayer);
        } else {
          L.polyline(line, { color: color, weight: 1, opacity: 0.2, interactive: false }).addTo(trajLayer);
        }
      }
    }
  }
}

function drawHits(day) {
  hitLayer.clearLayers();
  for (const r of HITS) {
    const [h, m, age] = r;
    if (!ACTIVE[String(h)]) continue;
    const i = age + 120;
    if (dayOf(i) !== day) continue;
    const p = TRAJ[String(h)][String(m)][i];
    L.circleMarker([p[0], p[1]], {
      radius: 5.5, color: "#000", weight: 1.5,
      fillColor: zColor(p[2]), fillOpacity: 1,
      bubblingMouseEvents: false
    })
      .on("click", () => showHit(r, p))
      .addTo(hitLayer);
  }
  restack();
}

function setDay(day) {
  currentDay = day;
  resetDetails();
  sel.value = day;
  trueColor.options.date = day;
  trueColor.redraw();
  fires.setParams({ time: day });
  drawClusters(day);
  drawTraj(day);
  drawHits(day);
}

// ---------- day dropdown ----------
for (const d of DAYS) {
  const o = document.createElement("option");
  o.value = d;
  o.textContent = Number(d.slice(8)) + " August 2024";
  sel.appendChild(o);
}
sel.onchange = () => setDay(sel.value);
setDay("2024-08-10");

// ---------- layer check boxes ----------
function bindLayer(id, layer) {
  const box = document.getElementById(id);
  box.addEventListener("change", () => {
    if (box.checked) layer.addTo(map); else map.removeLayer(layer);
    restack();
  });
}
bindLayer("l-base", trueColor);
bindLayer("l-fire", fires);
bindLayer("l-clu", clusterLayer);
bindLayer("l-traj", trajLayer);
bindLayer("l-hit", hitLayer);

document.querySelectorAll(".hsel").forEach(box => {
  box.addEventListener("change", () => {
    ACTIVE[box.value] = box.checked;
    drawTraj(currentDay);
    drawHits(currentDay);
  });
});

// ---------- nearest trajectory point (hover and click) ----------
const allPoints = [];
for (const h of ["1500", "3000", "3600"]) {
  for (const m in TRAJ[h]) {
    TRAJ[h][m].forEach((p, i) => {
      allPoints.push({ h: h, m: m, i: i, day: dayOf(i), lat: p[0], lon: p[1], z: p[2], mld: p[3] });
    });
  }
}

function nearestPoint(cp) {
  if (!map.hasLayer(trajLayer)) return null;
  let best = null, bestD = 15 * 15;
  for (const q of allPoints) {
    if (q.day !== currentDay || !ACTIVE[q.h]) continue;
    const p = map.latLngToContainerPoint([q.lat, q.lon]);
    const dx = p.x - cp.x, dy = p.y - cp.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD) { bestD = d2; best = q; }
  }
  return best;
}

const tip = L.tooltip({ direction: "right", offset: [12, 0] });
const ring = L.circleMarker([0, 0], { radius: 8, color: "#fff", weight: 2, fill: false, interactive: false });

let busy = false;
map.on("mousemove", e => {
  if (busy) return;
  busy = true;
  setTimeout(() => { busy = false; }, 40);

  const best = nearestPoint(e.containerPoint);
  if (!best) { map.closeTooltip(tip); ring.remove(); return; }

  ring.setLatLng([best.lat, best.lon]).addTo(map);
  tip.setLatLng([best.lat, best.lon]).setContent(
    "<b>" + best.h + " m start, member " + best.m + "</b><br>" +
    whenOf(best.i) + " (" + (best.i - 120) + " h)<br>" +
    "Height " + best.z + " m above ground<br>" +
    "Mixed layer " + best.mld + " m");
  map.openTooltip(tip);
});

map.on("click", e => {
  const best = nearestPoint(e.containerPoint);
  if (best) showPoint(best);
});

document.addEventListener("click", e => {
  if (!e.target.closest("#map-frame, #details, #layers")) resetDetails();
});