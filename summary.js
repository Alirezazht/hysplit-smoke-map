(function () {
  const heights = ["1500", "3000", "3600"];

  function median(a) {
    if (!a.length) return null;
    const s = a.slice().sort(function (x, y) { return x - y; });
    const n = s.length;
    return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  }
  function fmt(v) { return v === null ? "-" : Math.round(v).toLocaleString("en-US"); }

  let html = '<table class="sumtable">' +
    '<tr><th>Start (m)</th><th>Members</th>' +
    '<th>Height, m<br>median (range)</th><th>MLD, m<br>median</th><th>At or below MLD</th></tr>';

  heights.forEach(function (h) {
    const rows = HITS.filter(function (r) { return String(r[0]) === h; });
    const zs = [], mlds = [], members = new Set();
    let below = 0;
    rows.forEach(function (r) {
      const p = TRAJ[h][String(r[1])][r[2] + 120];   // [lat, lon, height, MLD]
      zs.push(p[2]); mlds.push(p[3]); members.add(r[1]);
      if (p[2] <= p[3]) below++;
    });
    const n = rows.length;
    html += "<tr><td>" + h + "</td>" +
      "<td>" + members.size + " of 27</td>" +
      "<td>" + fmt(median(zs)) + (n ? "<br><small>" + fmt(Math.min.apply(null, zs)) + " to " + fmt(Math.max.apply(null, zs)) + "</small>" : "") + "</td>" +
      "<td>" + fmt(median(mlds)) + "</td>" +
      "<td>" + (n ? Math.round(100 * below / n) + " %" : "-") + "</td></tr>";
  });

  html += "</table>";
  document.getElementById("summary").innerHTML = html;
})();

(function () {
  const btn = document.getElementById("sum-btn");
  const card = document.getElementById("sum-card");
  const close = document.getElementById("sum-close");
  btn.addEventListener("click", function (e) {
    e.stopPropagation();               // so the click does not reset "Selected point"
    card.hidden = !card.hidden;
  });
  close.addEventListener("click", function () { card.hidden = true; });
})();