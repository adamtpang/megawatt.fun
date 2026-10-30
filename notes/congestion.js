(function () {
  var data = null;
  var state = { zone: "all", block: "all", metric: "p95", selected: null };

  var METRIC = {
    p95: { label: "95th percentile basis", money: true },
    mean: { label: "mean basis", money: true },
    share20: { label: "share of hours at least $20/MWh above the zone", money: false }
  };
  var BLOCK = {
    all: "all hours",
    night: "hour ending 1–6",
    morning: "hour ending 7–12",
    afternoon: "hour ending 13–18",
    evening: "hour ending 19–24"
  };
  var ZONE = {
    all: "Houston, North, and South",
    LZ_HOUSTON: "Houston",
    LZ_NORTH: "North",
    LZ_SOUTH: "South"
  };

  function ready() {
    fetch("/data/congestion.json")
      .then(function (res) {
        if (!res.ok) throw new Error("data " + res.status);
        return res.json();
      })
      .then(function (json) {
        data = json;
        var vintage = document.getElementById("vintage");
        if (vintage) vintage.textContent = json.vintage;
        var note = document.getElementById("map-note");
        if (note && json.coverage && json.coverage.hifld) {
          var hit = json.coverage.hifld;
          note.textContent = json.map && json.map.drawn
            ? "Map drawn from unique HIFLD name matches."
            : "No map. A unique HIFLD name matched " + hit.matched + " of " + hit.attempted +
              " ranked substations, and " + hit.top15_matched + " of the top 15. Unmatched nodes are not placed.";
        }
        bind();
        draw();
      })
      .catch(function (err) {
        var status = document.getElementById("status");
        if (status) status.textContent = "The price file did not load (" + err.message + "). The findings below are the static copy.";
      });
  }

  function bind() {
    document.querySelectorAll("[data-zone]").forEach(function (button) {
      button.addEventListener("click", function () {
        state.zone = button.getAttribute("data-zone");
        press("[data-zone]", "data-zone", state.zone);
        draw();
      });
    });
    document.querySelectorAll("[data-block]").forEach(function (button) {
      button.addEventListener("click", function () {
        state.block = button.getAttribute("data-block");
        press("[data-block]", "data-block", state.block);
        draw();
      });
    });
    document.querySelectorAll("[data-metric]").forEach(function (button) {
      button.addEventListener("click", function () {
        state.metric = button.getAttribute("data-metric");
        press("[data-metric]", "data-metric", state.metric);
        draw();
      });
    });
  }

  function press(selector, attr, value) {
    document.querySelectorAll(selector).forEach(function (button) {
      button.setAttribute("aria-pressed", button.getAttribute(attr) === value ? "true" : "false");
    });
  }

  function statsOf(node) {
    if (state.block === "all") return node;
    return (node.blocks && node.blocks[state.block]) || null;
  }

  function rows() {
    return data.nodes.filter(function (node) {
      if (state.zone !== "all" && node.zone !== state.zone) return false;
      return !!statsOf(node);
    }).map(function (node) {
      var stats = statsOf(node);
      return { node: node, stats: stats, value: stats[state.metric] };
    }).sort(function (a, b) {
      if (b.value !== a.value) return b.value - a.value;
      return a.node.name < b.node.name ? -1 : 1;
    });
  }

  function formatValue(value) {
    if (state.metric === "share20") return (value * 100).toFixed(1) + "%";
    var sign = value < 0 ? "−" : "";
    return sign + "$" + Math.abs(value).toFixed(2);
  }

  function money(value) {
    if (value === undefined || value === null) return "—";
    var sign = value < 0 ? "−" : "";
    return sign + "$" + Math.abs(value).toFixed(2);
  }

  function draw() {
    var ranked = rows();
    var status = document.getElementById("status");
    var shown = Math.min(15, ranked.length);
    if (status) {
      status.textContent = shown + " of " + ranked.length + " nodes in " + ZONE[state.zone] +
        ", " + BLOCK[state.block] + ", ranked by " + METRIC[state.metric].label + ".";
    }
    if (!ranked.length) {
      state.selected = null;
      document.getElementById("bars").innerHTML = "<p class='quiet'>No node has 20 hours in this block.</p>";
      document.getElementById("top-body").innerHTML = "";
      document.getElementById("detail").innerHTML = "<p class='quiet'>Nothing to select in this filter.</p>";
      return;
    }
    if (!ranked.some(function (row) { return row.node.name === state.selected; })) {
      state.selected = ranked[0].node.name;
    }
    var max = ranked.slice(0, 15).reduce(function (peak, row) {
      return Math.max(peak, row.value);
    }, 0);
    var bars = document.getElementById("bars");
    bars.innerHTML = "";
    ranked.slice(0, 15).forEach(function (row) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "bar-row";
      button.setAttribute("role", "listitem");
      button.setAttribute("aria-current", row.node.name === state.selected ? "true" : "false");
      var width = max > 0 ? Math.max(0, row.value) / max * 100 : 0;
      button.innerHTML =
        "<span class='bar-name'>" + escapeHtml(row.node.name) + "</span>" +
        "<span class='bar-track'><span class='bar-fill " + escapeHtml(row.node.zone) + "' style='width:" + width.toFixed(1) + "%'></span></span>" +
        "<span class='bar-val'>" + formatValue(row.value) + "</span>";
      button.addEventListener("click", function () {
        state.selected = row.node.name;
        draw();
      });
      bars.appendChild(button);
    });
    var body = document.getElementById("top-body");
    body.innerHTML = "";
    ranked.slice(0, 10).forEach(function (row, index) {
      var tr = document.createElement("tr");
      tr.setAttribute("aria-selected", row.node.name === state.selected ? "true" : "false");
      tr.innerHTML =
        "<td>" + (index + 1) + "</td>" +
        "<td>" + escapeHtml(row.node.name) + "</td>" +
        "<td>" + escapeHtml(ZONE[row.node.zone] || row.node.zone) + "</td>" +
        "<td>" + escapeHtml(row.node.substation || "") + "</td>" +
        "<td class='num'>" + row.stats.hours + "</td>" +
        "<td class='num'>" + money(row.stats.mean) + "</td>" +
        "<td class='num'>" + money(row.stats.p95) + "</td>" +
        "<td class='num'>" + (row.stats.share20 * 100).toFixed(1) + "%</td>" +
        "<td class='num'>" + row.stats.scarcity + "</td>" +
        "<td class='num'>" + (row.node.shadow_rows || 0) + "</td>";
      tr.addEventListener("click", function () {
        state.selected = row.node.name;
        draw();
      });
      body.appendChild(tr);
    });
    var current = ranked.filter(function (row) { return row.node.name === state.selected; })[0];
    renderDetail(current);
  }

  function renderDetail(row) {
    var node = row.node;
    var stats = row.stats;
    var names = (node.shadow_names || []).join(", ");
    var hub = state.block === "all" && node.p95_hub !== undefined
      ? "<dt>95th vs hub " + escapeHtml(node.hub) + "</dt><dd>" + money(node.p95_hub) + "/MWh</dd>"
      : "";
    document.getElementById("detail").innerHTML =
      "<p class='zone-chip'>" + escapeHtml(ZONE[node.zone] || node.zone) + " · " + escapeHtml(node.substation || "no substation") +
      (node.kv ? " · " + escapeHtml(String(node.kv)) + " kV" : "") + "</p>" +
      "<h2>" + escapeHtml(node.name) + "</h2>" +
      "<dl>" +
      "<dt>" + escapeHtml(METRIC[state.metric].label) + "</dt><dd>" + formatValue(row.value) + "</dd>" +
      "<dt>Mean basis</dt><dd>" + money(stats.mean) + "/MWh</dd>" +
      "<dt>95th percentile</dt><dd>" + money(stats.p95) + "/MWh</dd>" +
      "<dt>Hours ≥ $20</dt><dd>" + (stats.share20 * 100).toFixed(1) + "%</dd>" +
      "<dt>Hours node ≥ $100</dt><dd>" + stats.scarcity + " of " + stats.hours + "</dd>" +
      hub +
      "<dt>Shadow rows at substation</dt><dd>" + (node.shadow_rows || 0) + "</dd>" +
      "</dl>" +
      "<p class='quiet'>Station-name match for the full window" +
      (names ? ": " + escapeHtml(names) + "." : ". No positive shadow-price row uses this substation name.") +
      " The $20 and $100 cutoffs are labels for this note.</p>";
  }

  function escapeHtml(value) {
    return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready);
  else ready();
})();
