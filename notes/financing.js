(function () {
  var data = null;
  var zone = "LZ_HOUSTON";

  function money(value) {
    if (value === null || value === undefined || value !== value) return "—";
    var sign = value < 0 ? "−" : "";
    return sign + "$" + Math.abs(Math.round(value)).toLocaleString("en-US");
  }

  function ready() {
    fetch("/data/financing.json")
      .then(function (res) {
        if (!res.ok) throw new Error("data " + res.status);
        return res.json();
      })
      .then(function (json) {
        data = json;
        boot();
      })
      .catch(function (err) {
        document.getElementById("vintage").textContent = "The revenue file did not load (" + err.message + ").";
      });
  }

  function boot() {
    var defs = data.defaults;
    document.getElementById("vintage").textContent =
      "Day-ahead load-zone prices, 2018 through 2025. Built " + data.generated + ".";
    document.getElementById("method").textContent = data.method;
    document.getElementById("battery-note").textContent =
      defs.energy_source + " " + defs.power_source + " " + defs.rte_source;
    document.querySelectorAll("[data-zone]").forEach(function (button) {
      button.addEventListener("click", function () {
        zone = button.getAttribute("data-zone");
        document.querySelectorAll("[data-zone]").forEach(function (other) {
          other.setAttribute("aria-pressed", other === button ? "true" : "false");
        });
        render();
      });
    });
    ["energy", "power", "rte", "capex", "spread", "term", "fade", "delay", "case"].forEach(function (id) {
      document.getElementById(id).addEventListener("input", render);
      document.getElementById(id).addEventListener("change", render);
    });
    render();
  }

  function read(id) {
    return Number(document.getElementById(id).value);
  }

  function render() {
    document.getElementById("o-energy").textContent = read("energy").toFixed(1);
    document.getElementById("o-power").textContent = read("power").toFixed(1);
    document.getElementById("o-rte").textContent = read("rte") + "%";
    document.getElementById("o-capex").textContent = read("capex") ? "$" + read("capex") : "blank";
    document.getElementById("o-spread").textContent = read("spread").toFixed(1);
    document.getElementById("o-term").textContent = String(read("term"));
    document.getElementById("o-fade").textContent = read("fade").toFixed(1) + "%";
    document.getElementById("o-delay").textContent = String(read("delay"));

    var block = data.zones[zone];
    var years = block.years;
    var max = Math.max.apply(null, years.map(function (item) { return item.revenue_usd; }));
    document.getElementById("headline").innerHTML =
      stat("P50", money(block.p50_usd)) +
      stat("P90 exceedance", money(block.p90_exceedance_usd)) +
      stat("Worst, " + block.worst_year, money(block.worst_usd)) +
      stat("Best, " + block.best_year, money(block.best_usd));
    document.getElementById("bars").innerHTML = years.map(function (item) {
      var width = max ? Math.max(2, Math.round(100 * item.revenue_usd / max)) : 0;
      var current = String(item.year) === String(block.worst_year) ? ' aria-current="true"' : "";
      return '<div class="bar-row"' + current + '><span class="bar-name">' + item.year +
        '</span><span class="bar-track"><span class="bar-fill ' + zone + '" style="width:' + width +
        '%"></span></span><span class="bar-val">' + money(item.revenue_usd) + "</span></div>";
    }).join("");
    document.getElementById("year-body").innerHTML = years.map(function (item) {
      return "<tr><td>" + item.year + '</td><td class="num">' + money(item.revenue_usd) +
        '</td><td class="num">' + item.hours.toLocaleString("en-US") + "</td></tr>";
    }).join("");
    var ratio = block.p50_usd ? block.worst_usd / block.p50_usd : null;
    document.getElementById("predict").textContent =
      "Eight years. Mean " + money(block.mean_usd) + ", sample standard deviation " + money(block.stdev_usd) +
      ". The worst year is " + (ratio === null ? "—" : Math.round(ratio * 100) + "%") +
      " of the median. P90 exceedance is the 10th percentile: the revenue 90% of these years beat. " +
      "With eight years that percentile is coarse. 2021 is the spike year to read beside the median, not instead of it.";

    renderDebt(block);
  }

  function stat(label, value) {
    return '<div class="stat"><div class="v">' + value + '</div><div class="l">' + label + "</div></div>";
  }

  function baseRate() {
    var treasury = data.treasury_10y;
    if (treasury && treasury.available) return treasury.percent / 100;
    return null;
  }

  function caseRevenue(block) {
    var which = document.getElementById("case").value;
    if (which === "p90") return block.p90_exceedance_usd;
    if (which === "worst") return block.worst_usd;
    return block.p50_usd;
  }

  function renderDebt(block) {
    var energy = read("energy");
    var capexRate = read("capex");
    var term = read("term");
    var fade = read("fade") / 100;
    var delay = read("delay");
    var spread = read("spread") / 100;
    var rate = baseRate();
    var note = "";
    if (rate === null) {
      note = "The Treasury CSV did not load, so the interest rate is only the spread you set. ";
      rate = 0;
    } else {
      note = "10-year Treasury " + data.treasury_10y.percent + "% on " + data.treasury_10y.date + ". ";
    }
    rate += spread;
    var capex = energy * capexRate;
    var out = document.getElementById("debt-out");
    if (!(capex > 0) || !(term > 0)) {
      out.textContent = note + "Move capital cost above zero to size a loan. At zero there is no debt service to cover. " + data.defaults.capex_source;
      document.getElementById("dscr-body").innerHTML = "";
      return;
    }
    var balance = capex * Math.pow(1 + rate / 12, delay);
    var payment = rate === 0 ? balance / term : balance * rate / (1 - Math.pow(1 + rate, -term));
    var baseRevenue = caseRevenue(block);
    var rows = "";
    var min = null;
    for (var year = 1; year <= term; year++) {
      var revenue = baseRevenue * Math.pow(1 - fade, year - 1);
      var dscr = payment ? revenue / payment : null;
      if (min === null || dscr < min) min = dscr;
      rows += "<tr><td>" + year + '</td><td class="num">' + money(revenue) +
        '</td><td class="num">' + money(payment) + '</td><td class="num">' +
        (dscr === null ? "—" : dscr.toFixed(2)) + "</td></tr>";
    }
    document.getElementById("dscr-body").innerHTML = rows;
    var changed = Math.abs(energy - data.defaults.energy_kwh) > 0.05 ||
      Math.abs(read("power") - data.defaults.power_kw) > 0.05 ||
      Math.abs(read("rte") / 100 - data.defaults.rte) > 0.005;
    out.textContent = note +
      "Loan balance at first operation " + money(balance) +
      " after " + delay + " months of capitalized interest. Annual payment " + money(payment) +
      ". Lowest coverage " + (min === null ? "—" : min.toFixed(2)) +
      " on the " + document.getElementById("case").selectedOptions[0].textContent.toLowerCase() +
      " of " + zone.replace("LZ_", "") + ". " +
      (changed ? "Energy, power, or efficiency no longer match the dispatch that produced these revenues. The dollars above are still that dispatch." : "Revenues are the dispatch at 39.2 kWh, 9.8 kW, and 90% round trip.");
  }

  ready();
})();
