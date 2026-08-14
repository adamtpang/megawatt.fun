// Package ercot fetches day-ahead settlement point prices from ERCOT's
// public (keyless) system-wide prices dashboard endpoint.
//
// Caveat found by testing, not assumption: ercot.com sits behind
// Imperva and rejects many non-US IPs with a 403 regardless of headers.
// From a US network the endpoint works directly; elsewhere, use the
// vendored CSV in data/ (a real captured day) or a US egress.
package ercot

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/adamtpang/megawatt.fun/dispatch"
)

const Endpoint = "https://www.ercot.com/api/1/services/read/dashboards/systemWidePrices.json"

type payload struct {
	LastUpdated string `json:"lastUpdated"`
	DamSppData  []struct {
		HourEnding int     `json:"hourEnding"`
		HbHubAvg   float64 `json:"hbHubAvg"`
	} `json:"damSppData"`
}

// Parse extracts day-ahead hourly hub-average prices from the endpoint's
// JSON body. Split from Fetch so it is testable against a real captured
// response without a network.
func Parse(body []byte) ([]dispatch.PricePoint, string, error) {
	var p payload
	if err := json.Unmarshal(body, &p); err != nil {
		return nil, "", fmt.Errorf("ercot payload: %w", err)
	}
	if len(p.DamSppData) == 0 {
		return nil, "", fmt.Errorf("ercot payload has no day-ahead rows")
	}
	pts := make([]dispatch.PricePoint, 0, len(p.DamSppData))
	for _, r := range p.DamSppData {
		pts = append(pts, dispatch.PricePoint{
			Interval:  fmt.Sprintf("%02d:00", r.HourEnding),
			USDPerMWh: r.HbHubAvg,
		})
	}
	return pts, p.LastUpdated, nil
}

// FetchDayAhead pulls the live endpoint. Expect a 403 from non-US IPs.
func FetchDayAhead() ([]dispatch.PricePoint, string, error) {
	client := &http.Client{Timeout: 15 * time.Second}
	req, err := http.NewRequest(http.MethodGet, Endpoint, nil)
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("User-Agent", "megawatt.fun dispatch demo (github.com/adamtpang)")
	res, err := client.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("ercot returned %d (geo-blocked outside the US; use -csv with the vendored real day instead)", res.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	if err != nil {
		return nil, "", err
	}
	return Parse(body)
}
