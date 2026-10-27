(function () {
  var data = null;
  var weights = {};
  var selected = "TX";

  function ready() {
    fetch("/data/expansion-map.json")
      .then(function (res) {
        if (!res.ok) throw new Error("data " + res.status);
        return res.json();
      })
      .then(function (json) {
        data = json;
        boot();
      })
      .catch(function (err) {
        var vintage = document.getElementById("vintage");
        if (vintage) vintage.textContent = "The data file did not load (" + err.message + ").";
      });
  }

  function boot() {
    document.getElementById("vintage").textContent = data.vintage;
    weights = {};
    data.factors.forEach(function (factor) { weights[factor.id] = factor.weight; });
    renderControls();
    renderNarrative();
    renderMap();
    renderErcot();
    renderLists();
    refresh();
    document.getElementById("preset-equal").addEventListener("click", function () { applyPreset("equal"); });
    document.getElementById("preset-pull").addEventListener("click", function () { applyPreset("pull"); });
    document.getElementById("preset-access").addEventListener("click", function () { applyPreset("access"); });
    document.getElementById("preset-nosize").addEventListener("click", function () { applyPreset("nosize"); });
  }

  function groupOf(id) {
    var factor = data.factors.find(function (item) { return item.id === id; });
    return factor ? factor.group : "";
  }

  function applyPreset(name) {
    data.factors.forEach(function (factor) {
      var on = true;
      if (name === "pull") on = factor.group === "Customer pull";
      if (name === "access") on = factor.group === "Market access";
      if (name === "nosize") on = factor.id !== "homes";
      weights[factor.id] = on ? 1 : 0;
      var input = document.getElementById("w-" + factor.id);
      var output = document.getElementById("o-" + factor.id);
      if (input) input.value = String(Math.round(weights[factor.id] * 100));
      if (output) output.textContent = input.value;
    });
    ["equal", "pull", "access", "nosize"].forEach(function (key) {
      document.getElementById("preset-" + key).setAttribute("aria-pressed", key === name ? "true" : "false");
    });
    refresh();
  }

  function renderControls() {
    var form = document.getElementById("weights");
    var groups = [];
    data.factors.forEach(function (factor) {
      if (groups.indexOf(factor.group) === -1) groups.push(factor.group);
    });
    form.innerHTML = groups.map(function (group) {
      var sliders = data.factors.filter(function (factor) { return factor.group === group; }).map(function (factor) {
        var value = Math.round(factor.weight * 100);
        return '<div class="slider"><label for="w-' + factor.id + '">' + escapeHtml(factor.label) +
          '</label><output id="o-' + factor.id + '" for="w-' + factor.id + '">' + value +
          '</output><input id="w-' + factor.id + '" type="range" min="0" max="100" value="' + value +
          '" aria-describedby="h-' + factor.id + '"><p class="quiet" id="h-' + factor.id + '">' +
          escapeHtml(factor.help) + "</p></div>";
      }).join("");
      return '<fieldset class="group"><legend><h2>' + escapeHtml(group) + "</h2></legend>" + sliders + "</fieldset>";
    }).join("") +
      '<section class="group"><h2>Install friction</h2><p class="quiet">No national permitting or home-battery interconnection timeline made it into the score. The reasons are under What was left out.</p></section>';
    form.addEventListener("submit", function (event) { event.preventDefault(); });
    form.addEventListener("input", function (event) {
      var target = event.target;
      if (!target.id || target.id.indexOf("w-") !== 0) return;
      var id = target.id.slice(2);
      weights[id] = Number(target.value) / 100;
      document.getElementById("o-" + id).textContent = target.value;
      ["equal", "pull", "access", "nosize"].forEach(function (key) {
        document.getElementById("preset-" + key).setAttribute("aria-pressed", "false");
      });
      refresh();
    });
  }

  function ranksFor(rows) {
    var table = {};
    data.factors.forEach(function (factor) {
      var values = rows.map(function (row) { return row.values[factor.id]; });
      var ranks = window.ExpansionScore.percentileRanks(values);
      table[factor.id] = {};
      rows.forEach(function (row, index) { table[factor.id][row.id] = ranks[index]; });
    });
    var rankRows = rows.map(function (row) {
      var record = { id: row.id };
      data.factors.forEach(function (factor) { record[factor.id] = table[factor.id][row.id]; });
      return record;
    });
    var scores = window.ExpansionScore.composite(rankRows, weights);
    return rows.map(function (row, index) {
      return { row: row, score: scores[index] };
    });
  }

  function ordered(scored) {
    return scored.slice().sort(function (a, b) {
      var as = a.score === null ? -1 : a.score;
      var bs = b.score === null ? -1 : b.score;
      if (bs !== as) return bs - as;
      return a.row.name.localeCompare(b.row.name);
    });
  }

  function refresh() {
    var stateScores = {};
    ordered(ranksFor(data.states)).forEach(function (item, index) {
      stateScores[item.row.id] = { score: item.score, rank: index + 1 };
    });
    paintMap(stateScores);
    fillTable("state-body", ordered(ranksFor(data.states)).slice(0, 10), stateRow);
    fillTable("utility-body", ordered(ranksFor(data.utilities)).slice(0, 10), utilityRow);
    var equal = data.factors.every(function (factor) { return Math.abs(weights[factor.id] - factor.weight) < 0.001; });
    document.getElementById("weight-note").textContent = equal
      ? "This table matches the equal-weight reading in What this suggests."
      : "The weights have moved. What this suggests still describes equal weights.";
    showState(selected, stateScores[selected]);
  }

  function fillTable(id, rows, builder) {
    document.getElementById(id).innerHTML = rows.map(builder).join("");
  }

  function stateRow(item, index) {
    var row = item.row;
    var mark = row.footprint ? " · " + row.footprint.label : "";
    return "<tr data-state=\"" + row.id + "\" tabindex=\"0\" aria-selected=\"" + (row.id === selected) + "\">" +
      "<td>" + (index + 1) + "</td><td>" + escapeHtml(row.name) + mark + "</td>" +
      '<td class="num">' + points(item.score) + "</td>" +
      '<td class="num">' + fmt("homes", row.values.homes) + "</td>" +
      '<td class="num">' + fmt("saidi", row.values.saidi) + "</td>" +
      '<td class="num">' + fmt("retail", row.values.retail) + "</td>" +
      "<td>" + escapeHtml(row.detail.rtos || "—") + "</td></tr>";
  }

  function utilityRow(item, index) {
    var row = item.row;
    return "<tr><td>" + (index + 1) + "</td><td>" + escapeHtml(row.name) + "</td><td>" + row.state + "</td>" +
      '<td class="num">' + points(item.score) + "</td>" +
      '<td class="num">' + fmt("homes", row.values.homes) + "</td>" +
      '<td class="num">' + fmt("saidi", row.values.saidi) + "</td>" +
      "<td>" + escapeHtml(row.detail.rtos || "—") + "</td></tr>";
  }

  function points(score) {
    return score === null ? "—" : String(Math.round(score * 100));
  }

  function fmt(id, value) {
    if (value === null || value === undefined || value !== value) return "—";
    if (id === "homes" || id === "saidi") return Math.round(value).toLocaleString("en-US");
    if (id === "saifi") return Number(value).toFixed(2);
    if (id === "retail" || id === "wholesale") return (value * 100).toFixed(1) + "%";
    if (id === "storm" || id === "heat") return Number(value).toFixed(1);
    return Number(value).toFixed(2);
  }

  function renderMap() {
    var svg = document.getElementById("map");
    var paths = data.map.map(function (shape) {
      return '<path data-state="' + shape.id + '" d="' + shape.d + '" fill-rule="evenodd" tabindex="0" role="button" aria-label="' + shape.id + '"></path>';
    }).join("");
    var badges = data.map.filter(function (shape) {
      var state = data.states.find(function (item) { return item.id === shape.id; });
      return state && state.footprint;
    }).map(function (shape) {
      var state = data.states.find(function (item) { return item.id === shape.id; });
      var letter = state.footprint.status === "operating" ? "O" : state.footprint.status === "announced" ? "A" : "H";
      var fill = state.footprint.status === "operating" ? "#7fd6a4" : state.footprint.status === "announced" ? "#ffc46b" : "#9fd8ec";
      return '<g class="mark" transform="translate(' + shape.cx + "," + shape.cy + ')" aria-hidden="true">' +
        '<circle r="9" fill="' + fill + '"></circle>' +
        '<text class="badge" text-anchor="middle" y="4">' + letter + "</text></g>";
    }).join("");
    var title = svg.querySelector("title");
    svg.innerHTML = (title ? title.outerHTML : "") + paths + badges;
    svg.addEventListener("click", onStateEvent);
    svg.addEventListener("keydown", function (event) {
      if (event.key !== "Enter" && event.key !== " ") return;
      onStateEvent(event);
      event.preventDefault();
    });
    document.getElementById("state-body").addEventListener("click", onStateEvent);
    document.getElementById("state-body").addEventListener("keydown", function (event) {
      if (event.key !== "Enter" && event.key !== " ") return;
      onStateEvent(event);
    });
  }

  function onStateEvent(event) {
    var node = event.target.closest ? event.target.closest("[data-state]") : null;
    if (!node) return;
    selected = node.getAttribute("data-state");
    refresh();
  }

  function paintMap(scores) {
    document.querySelectorAll("#map path").forEach(function (path) {
      var id = path.getAttribute("data-state");
      var item = scores[id];
      var score = item ? item.score : null;
      path.setAttribute("fill", score === null ? "#1a2430" : mix(score));
      path.classList.toggle("selected", id === selected);
      var state = data.states.find(function (row) { return row.id === id; });
      var rank = item ? item.rank : "—";
      var pts = item ? points(item.score) : "—";
      path.setAttribute("aria-label", (state ? state.name : id) + ", score " + pts + ", rank " + rank);
    });
  }

  function mix(t) {
    var low = [28, 51, 72];
    var high = [255, 196, 107];
    var channels = low.map(function (value, index) {
      return Math.round(value + (high[index] - value) * t);
    });
    return "rgb(" + channels.join(",") + ")";
  }

  function showState(id, scored) {
    var state = data.states.find(function (row) { return row.id === id; });
    if (!state) return;
    var flag = "";
    if (state.footprint) {
      flag = '<p><span class="flag ' + state.footprint.status + '">' + escapeHtml(state.footprint.label) +
        "</span> " + escapeHtml(state.footprint.detail) + "</p>";
    }
    var rows = data.factors.map(function (factor) {
      return "<dt>" + escapeHtml(factor.label) + "</dt><dd>" + fmt(factor.id, state.values[factor.id]) + "</dd>";
    }).join("");
    document.getElementById("detail").innerHTML =
      "<p class=\"quiet\">Score " + (scored ? points(scored.score) : "—") + " · rank " + (scored ? scored.rank : "—") + " of " + data.states.length + "</p>" +
      "<h2>" + escapeHtml(state.name) + "</h2>" + flag +
      "<dl>" + rows + "</dl>" +
      '<p class="quiet">' + escapeHtml(state.detail.note || "") + "</p>";
  }

  function renderNarrative() {
    var box = document.getElementById("narrative");
    if (box.textContent.trim()) return;
    box.innerHTML = data.narrative.map(function (paragraph) {
      return "<p>" + escapeHtml(paragraph) + "</p>";
    }).join("");
  }

  function renderErcot() {
    var ercot = data.ercot;
    var host = document.getElementById("ercot");
    if (!ercot || !ercot.available) {
      host.innerHTML = "<p>" + escapeHtml((ercot && ercot.summary) || "The ERCOT extract was not available for this build.") + "</p>";
      return;
    }
    var zones = (ercot.zones || []).map(function (zone) {
      return "<tr><td>" + escapeHtml(zone.name) + "</td><td class=\"num\">" + zone.nodes +
        "</td><td class=\"num\">" + Number(zone.median_p95).toFixed(2) + "</td></tr>";
    }).join("");
    var nodes = (ercot.nodes || []).map(function (node) {
      return "<tr><td>" + escapeHtml(node.name) + "</td><td>" + escapeHtml(node.zone) +
        "</td><td>" + escapeHtml(node.substation || "—") + "</td><td class=\"num\">" + node.hours +
        "</td><td class=\"num\">" + Number(node.p95_basis).toFixed(2) + "</td><td class=\"num\">" +
        Number(node.mean_basis).toFixed(2) + "</td><td class=\"num\">" + (node.share_ge_20 * 100).toFixed(1) +
        "%</td></tr>";
    }).join("");
    var constraints = (ercot.constraints || []).map(function (row) {
      return "<tr><td>" + escapeHtml(row.name) + "</td><td>" + escapeHtml(row.from || "—") +
        " → " + escapeHtml(row.to || "—") + "</td><td class=\"num\">" + row.hours +
        "</td><td class=\"num\">" + Number(row.shadow_sum).toFixed(0) + "</td></tr>";
    }).join("");
    host.innerHTML = "<p>" + escapeHtml(ercot.summary) + "</p>" +
      (zones ? '<table><caption>Load zones in this window</caption><thead><tr><th>Zone</th><th class="num">Nodes</th><th class="num">Median p95 basis</th></tr></thead><tbody>' + zones + "</tbody></table>" : "") +
      '<table><caption>Highest day-ahead basis, node minus its load zone</caption><thead><tr><th>Node</th><th>Zone</th><th>Substation</th><th class="num">Hours</th><th class="num">p95 $/MWh</th><th class="num">Mean $/MWh</th><th class="num">Hours ≥ $20</th></tr></thead><tbody>' + nodes + "</tbody></table>" +
      (constraints ? '<table><caption>Constraints with a positive day-ahead shadow price</caption><thead><tr><th>Constraint</th><th>Stations</th><th class="num">Hours</th><th class="num">Shadow sum</th></tr></thead><tbody>' + constraints + "</tbody></table>" : "") +
      ercot.notes.map(function (note) { return '<p class="quiet">' + escapeHtml(note) + "</p>"; }).join("");
  }

  function renderLists() {
    document.getElementById("omitted").innerHTML = data.omitted.map(function (item) {
      return "<li><strong>" + escapeHtml(item.title) + ".</strong> " + escapeHtml(item.reason) + "</li>";
    }).join("");
    document.getElementById("sources").innerHTML = data.sources.map(function (item) {
      var link = item.url ? '<a href="' + escapeAttr(item.url) + '">' + escapeHtml(item.title) + "</a>" : escapeHtml(item.title);
      return "<li>" + link + ". " + escapeHtml(item.detail) + "</li>";
    }).join("");
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"]/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch];
    });
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/'/g, "&#39;");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready);
  else ready();
})();
