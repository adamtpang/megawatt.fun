/* Extra primary power that moves K, at this site's 2024 baseline.
   P2 / P = 10^(10 * dK), because K = (log10(P) - 6) / 10. */
(function () {
  var baselineTw = 20.120343123861566;
  var input = document.getElementById("dk");
  var out = document.getElementById("climb-out");
  var label = document.getElementById("dk-label");

  function gigawatts(dk, tw) {
    return tw * (Math.pow(10, 10 * dk) - 1) * 1000;
  }

  function render() {
    var dk = Number(input.value);
    var gw = gigawatts(dk, baselineTw);
    var shown = dk >= 0.001 ? dk.toFixed(3) : dk.toFixed(4);
    label.textContent = shown;
    out.textContent = "+" + shown + " K needs " + Math.round(gw).toLocaleString("en-US") + " GW of average new primary power.";
  }

  fetch("/data/kardashev-baseline.json")
    .then(function (response) { return response.json(); })
    .then(function (data) {
      if (data && typeof data.average_power_tw === "number") baselineTw = data.average_power_tw;
      render();
    })
    .catch(render);

  input.addEventListener("input", render);
  render();
})();
