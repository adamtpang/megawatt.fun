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
    document.getElementById("preset-start").addEventListener("click", function () { applyPreset("start"); });
    document.getElementById("preset-equal").addEventListener("click", function () { applyPreset("equal"); });
    document.getElementById("preset-pull").addEventListener("click", function () { applyPreset("pull"); });
    document.getElementById("preset-access").addEventListener("click", function () { applyPreset("access"); });
    document.getElementById("preset-nosize").addEventListener("click", function () { applyPreset("nosize"); });
    applyPreset("start");
  }

  function groupOf(id) {
    var factor = data.factors.find(function (item) { return item.id === id; });
    return factor ? factor.group : "";
  }

  var PRESET_KEYS = ["start", "equal", "pull", "access", "nosize"];
  var START_WEIGHTS = { launch_path: 3, wholesale: 2, retail: 1, homes: 1, batteries: 1, saidi: 1 };

  function applyPreset(name) {
    data.factors.forEach(function (factor) {
      var on = true;
      if (name === "pull") on = factor.group === "Customer pull";
      if (name === "access") on = factor.group === "Market access";
      if (name === "nosize") on = factor.id !== "homes";
      if (name === "start") on = START_WEIGHTS[factor.id] > 0;
      weights[factor.id] = name === "start" ? (START_WEIGHTS[factor.id] || 0) : (on ? 1 : 0);
      var input = document.getElementById("w-" + factor.id);
      var output = document.getElementById("o-" + factor.id);
      if (input) input.value = String(Math.round(weights[factor.id] * 100));
      if (output) output.textContent = input.value;
    });
    PRESET_KEYS.forEach(function (key) {
      var button = document.getElementById("preset-" + key);
      if (button) button.setAttribute("aria-pressed", key === name ? "true" : "false");
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
          '</output><input id="w-' + factor.id + '" type="range" min="0" max="300" value="' + value +
          '" aria-describedby="h-' + factor.id + '"><p class="quiet" id="h-' + factor.id + '">' +
          escapeHtml(factor.help) + "</p></div>";
      }).join("");
      return '<fieldset class="group"><legend><h2>' + escapeHtml(group) + "</h2></legend>" + sliders + "</fieldset>";
    }).join("") +
      '<section class="group"><h2>Not in the score</h2><p class="quiet">DSIRE, a complete SolarAPP+ jurisdiction list, and a national home-battery interconnection clock were not retrieved. The reasons are under What I could not see.</p></section>';
    form.addEventListener("submit", function (event) { event.preventDefault(); });
    form.addEventListener("input", function (event) {
      var target = event.target;
      if (!target.id || target.id.indexOf("w-") !== 0) return;
      var id = target.id.slice(2);
      weights[id] = Number(target.value) / 100;
      document.getElementById("o-" + id).textContent = target.value;
      PRESET_KEYS.forEach(function (key) {
        var button = document.getElementById("preset-" + key);
        if (button) button.setAttribute("aria-pressed", "false");
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
      return { row: row, score: scores[index], factors: rankRows[index] };
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
    var ranked = ordered(ranksFor(data.states));
    var stateScores = {};
    ranked.forEach(function (item, index) {
      stateScores[item.row.id] = { score: item.score, rank: index + 1, tier: window.ExpansionScore.tierOf(item.score) };
    });
    paintMap(stateScores);
    renderTiers(ranked, stateScores);
    renderStart(ranked);
    fillTable("state-body", ranked.slice(0, 10), stateRow);
    fillTable("utility-body", ordered(ranksFor(data.utilities)).slice(0, 10), utilityRow);
    var equal = data.factors.every(function (factor) { return Math.abs(weights[factor.id] - factor.weight) < 0.001; });
    var start = data.factors.every(function (factor) {
      return Math.abs(weights[factor.id] - (START_WEIGHTS[factor.id] || 0)) < 0.001;
    });
    document.getElementById("weight-note").textContent = start
      ? "This table is the start-here weighting: retail-choice path 3, wholesale 2, homes, batteries, SAIDI, and delivery share at 1. Other factors are off."
      : equal
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
      "<td>" + (index + 1) + "</td><td>" + escapeHtml(window.ExpansionScore.tierOf(item.score) || "—") +
      "</td><td>" + escapeHtml(row.name) + mark + "</td>" +
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
    if (id === "launch_path") return value >= 1 ? "Choice" : "Partnership";
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
      var fill = state.footprint.status === "operating" ? "#1e4d2b" : state.footprint.status === "announced" ? "#ed6c30" : "#048ee5";
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
    document.getElementById("tier-board").addEventListener("click", onStateEvent);
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
      var tier = item ? item.tier : null;
      path.setAttribute("fill", TIER_FILL[tier] || "#d8d7d5");
      path.classList.toggle("selected", id === selected);
      var state = data.states.find(function (row) { return row.id === id; });
      var rank = item ? item.rank : "—";
      var pts = item ? points(item.score) : "—";
      path.setAttribute("aria-label", (state ? state.name : id) + ", tier " + (tier || "—") + ", score " + pts + ", rank " + rank);
    });
  }

  var TIER_FILL = { S: "#102a17", A: "#1e4d2b", B: "#77a45a", C: "#b2dd79", Later: "#d8d7d5" };
  var TIER_ORDER = [
    { id: "S", label: "Target first" },
    { id: "A", label: "Strong case" },
    { id: "B", label: "Mixed" },
    { id: "C", label: "One constraint leads" },
    { id: "Later", label: "Thin public case" }
  ];

  function renderStart(ranked) {
    var list = document.getElementById("start-list");
    if (!list) return;
    list.innerHTML = ranked.slice(0, 5).map(function (item, index) {
      var row = item.row;
      var path = row.values.launch_path === 1 ? "Retail-choice path" : "Partnership path";
      var mark = row.footprint ? " · " + row.footprint.label : "";
      return "<li><strong>" + (index + 1) + ". " + escapeHtml(row.name) + "</strong> " +
        '<span class="mono">' + points(item.score) + "</span> · " + path + escapeHtml(mark) +
        "<br>" + escapeHtml(whyText(item)) + "</li>";
    }).join("");
  }

  function renderTiers(ranked, scores) {
    var board = document.getElementById("tier-board");
    board.innerHTML = TIER_ORDER.map(function (tier) {
      var cards = ranked.filter(function (item) { return scores[item.row.id].tier === tier.id; }).map(function (item) {
        var row = item.row;
        var mark = row.footprint ? '<span class="flag ' + row.footprint.status + '">' + escapeHtml(row.footprint.label) + "</span>" : "";
        return '<button type="button" class="tier-card" data-state="' + row.id + '" aria-current="' + (row.id === selected) + '">' +
          "<header><strong>" + escapeHtml(row.name) + "</strong><span class=\"mono\">" + points(item.score) + "</span></header>" +
          (mark ? "<p>" + mark + "</p>" : "") +
          '<p class="why">' + escapeHtml(whyText(item)) + "</p></button>";
      }).join("");
      if (!cards) return "";
      return '<section class="tier" aria-label="Tier ' + tier.id + '"><h3 class="tier-mark">' + tier.id + "<span>" + tier.label + "</span></h3><div class=\"tier-cards\">" + cards + "</div></section>";
    }).join("");
  }

  function whyText(item) {
    var parts = data.factors.filter(function (factor) {
      var rank = item.factors[factor.id];
      return weights[factor.id] > 0 && rank !== null && rank === rank;
    }).map(function (factor) {
      return { factor: factor, rank: item.factors[factor.id] };
    }).sort(function (a, b) { return b.rank - a.rank || a.factor.label.localeCompare(b.factor.label); });
    if (!parts.length) return "No weighted factor has a published value for this state.";
    var lead = parts.slice(0, 2).map(function (part) { return phrase(part.factor, item.row); });
    var text = sentence(lead.join(" and ")) + ".";
    var low = parts[parts.length - 1];
    var leadIds = parts.slice(0, 2).map(function (part) { return part.factor.id; });
    if (leadIds.indexOf(low.factor.id) === -1 && low.rank < 0.5) {
      var role = low.factor.group === "Market access"
        ? "The constraint in this score is "
        : "The weaker pull signal is ";
      text += " " + role + phrase(low.factor, item.row) + ".";
    }
    return text;
  }

  function phrase(factor, row) {
    var value = fmt(factor.id, row.values[factor.id]);
    if (factor.id === "homes") return value + " owner-occupied single-family homes";
    if (factor.id === "saidi") return "SAIDI " + value + " minutes";
    if (factor.id === "saifi") return "SAIFI " + value;
    if (factor.id === "storm") return "storm risk " + value;
    if (factor.id === "heat") return "heat-wave risk " + value;
    if (factor.id === "retail") return value + " residential delivery share";
    if (factor.id === "launch_path") return row.values.launch_path === 1 ? "a retail-choice path" : "a partnership path";
    if (factor.id === "wholesale") {
      return row.detail && row.detail.rtos ? "wholesale mix " + row.detail.rtos : value + " of residential customers in an ISO";
    }
    if (factor.id === "batteries") return value + " residential batteries per 1,000 customers";
    if (factor.id === "demand_response") return value + " demand-response enrollments per 1,000 customers";
    if (factor.id === "dynamic_pricing") return value + " dynamic-pricing enrollments per 1,000 customers";
    return factor.label + " " + value;
  }

  function sentence(text) {
    if (!text) return text;
    return text.charAt(0).toUpperCase() + text.slice(1);
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
      "<p class=\"quiet\">Tier " + (scored && scored.tier ? scored.tier : "—") + " · score " + (scored ? points(scored.score) : "—") + " · rank " + (scored ? scored.rank : "—") + " of " + data.states.length + "</p>" +
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
