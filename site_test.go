package main

import (
	"encoding/json"
	"encoding/xml"
	"os"
	"strings"
	"testing"
)

func readSiteFile(t *testing.T, name string) string {
	t.Helper()
	data, err := os.ReadFile(name)
	if err != nil {
		t.Fatalf("read %s: %v", name, err)
	}
	return string(data)
}

func TestProductionSecurityHeaders(t *testing.T) {
	var config struct {
		Headers []struct {
			Source  string `json:"source"`
			Headers []struct {
				Key   string `json:"key"`
				Value string `json:"value"`
			} `json:"headers"`
		} `json:"headers"`
	}
	if err := json.Unmarshal([]byte(readSiteFile(t, "vercel.json")), &config); err != nil {
		t.Fatalf("parse vercel.json: %v", err)
	}
	values := map[string]string{}
	for _, route := range config.Headers {
		if route.Source != "/(.*)" {
			continue
		}
		for _, header := range route.Headers {
			values[strings.ToLower(header.Key)] = header.Value
		}
	}
	csp := values["content-security-policy"]
	for _, directive := range []string{"default-src 'self'", "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'"} {
		if !strings.Contains(csp, directive) {
			t.Errorf("CSP missing %q", directive)
		}
	}
	if strings.Contains(csp, "*") {
		t.Error("CSP must not contain wildcard sources")
	}
	if values["x-content-type-options"] != "nosniff" {
		t.Errorf("X-Content-Type-Options = %q, want nosniff", values["x-content-type-options"])
	}
}

func TestCrawlerDiscoveryFiles(t *testing.T) {
	robots := readSiteFile(t, "robots.txt")
	for _, token := range []string{"GPTBot", "ChatGPT-User", "PerplexityBot", "ClaudeBot", "Google-Extended", "Applebot-Extended"} {
		if !strings.Contains(robots, "User-agent: "+token) {
			t.Errorf("robots.txt has no explicit policy for %s", token)
		}
	}
	if !strings.Contains(robots, "Sitemap: https://megawatt.fun/sitemap.xml") {
		t.Error("robots.txt does not reference the canonical sitemap")
	}

	var sitemap struct {
		URLs []struct {
			Location string `xml:"loc"`
		} `xml:"url"`
	}
	if err := xml.Unmarshal([]byte(readSiteFile(t, "sitemap.xml")), &sitemap); err != nil {
		t.Fatalf("parse sitemap.xml: %v", err)
	}
	locations := map[string]bool{}
	for _, entry := range sitemap.URLs {
		locations[entry.Location] = true
	}
	for _, location := range []string{
		"https://megawatt.fun/",
		"https://megawatt.fun/live",
		"https://megawatt.fun/about",
		"https://megawatt.fun/contact",
		"https://megawatt.fun/privacy",
	} {
		if !locations[location] {
			t.Errorf("sitemap missing %s", location)
		}
	}

	llms := readSiteFile(t, "llms.txt")
	for _, page := range []string{"https://megawatt.fun/", "https://megawatt.fun/live", "https://megawatt.fun/privacy"} {
		if !strings.Contains(llms, page) {
			t.Errorf("llms.txt missing %s", page)
		}
	}
}

func TestHomepagePublishesActionAndTrustLinks(t *testing.T) {
	home := readSiteFile(t, "index.html")
	for _, fragment := range []string{
		`href="/live">Live ERCOT prices`,
		`href="/about">About`,
		`href="/contact">Contact`,
		`href="/privacy">Privacy`,
	} {
		if !strings.Contains(home, fragment) {
			t.Errorf("homepage missing %q", fragment)
		}
	}

	styles := readSiteFile(t, "style.css")
	if !strings.Contains(styles, ":focus-visible") || !strings.Contains(styles, "outline: 3px solid") {
		t.Error("interactive links and controls need a visible keyboard focus style")
	}
}

func TestTrustPagesAreSubstantialAndCanonical(t *testing.T) {
	for _, page := range []string{"about.html", "contact.html", "privacy.html"} {
		html := readSiteFile(t, page)
		if len(html) < 2_000 {
			t.Errorf("%s is unexpectedly thin (%d bytes)", page, len(html))
		}
		if strings.Count(strings.ToLower(html), "<h1>") != 1 {
			t.Errorf("%s must contain exactly one H1", page)
		}
		path := strings.TrimSuffix(page, ".html")
		wantCanonical := `rel="canonical" href="https://megawatt.fun/` + path + `"`
		if !strings.Contains(html, wantCanonical) {
			t.Errorf("%s missing canonical %q", page, wantCanonical)
		}
	}
}
