package httpapi

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/example/studyflow/internal/event"
	"github.com/example/studyflow/internal/security"
	"github.com/example/studyflow/internal/service"
	"github.com/example/studyflow/internal/store"
)

func TestWeatherRoutesRequireAuthentication(t *testing.T) {
	bus := event.NewBus()
	tokens := security.NewTokenManager("weather-integration-test-secret", "test", time.Hour)
	handler := NewHandler(service.New(store.NewMemory(), tokens, bus), tokens, bus, slog.New(slog.NewTextHandler(io.Discard, nil)))
	for _, path := range []string{"/api/v1/weather?latitude=0&longitude=0", "/api/v1/weather/locations?q=Beijing"} {
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		if w.Code != 401 {
			t.Fatalf("unauthenticated route %s: %d", path, w.Code)
		}
	}
}

// Optional real-provider smoke check; normal tests stay offline and deterministic.
func TestWeatherLive(t *testing.T) {
	if os.Getenv("STUDYFLOW_WEATHER_LIVE") != "1" {
		t.Skip("set STUDYFLOW_WEATHER_LIVE=1 to check provider connectivity")
	}
	a := newWeatherAPI()
	for _, test := range []struct {
		path    string
		handler http.HandlerFunc
	}{
		{"/?latitude=39.9&longitude=116.4", a.current},
		{"/?q=Beijing", a.locations},
	} {
		w := httptest.NewRecorder()
		test.handler(w, httptest.NewRequest("GET", test.path, nil))
		if w.Code != 200 {
			t.Fatalf("live request %s: %d %s", test.path, w.Code, w.Body.String())
		}
	}
}

func TestWeatherValidation(t *testing.T) {
	a := newWeatherAPI()
	for _, query := range []string{"", "latitude=NaN&longitude=0", "latitude=0&longitude=Inf", "latitude=91&longitude=0", "latitude=0&longitude=-181"} {
		w := httptest.NewRecorder()
		a.current(w, httptest.NewRequest("GET", "/?"+query, nil))
		if w.Code != 400 {
			t.Fatalf("query %s: %d", query, w.Code)
		}
	}
	w := httptest.NewRecorder()
	a.locations(w, httptest.NewRequest("GET", "/?q=a", nil))
	if w.Code != 400 {
		t.Fatalf("short query: %d", w.Code)
	}
}

func TestWeatherProxyAndCache(t *testing.T) {
	calls := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.URL.Query().Get("latitude") != "39.900" || r.URL.Query().Get("timeformat") != "unixtime" {
			t.Error("incorrect provider query")
		}
		w.Write([]byte(`{"current":{"time":1788883200,"temperature_2m":18.3,"weather_code":2}}`))
	}))
	defer upstream.Close()
	a := newWeatherAPI()
	a.forecastURL = upstream.URL
	for i := 0; i < 2; i++ {
		w := httptest.NewRecorder()
		a.current(w, httptest.NewRequest("GET", "/?latitude=39.9&longitude=116.4", nil))
		if w.Code != 200 || !strings.Contains(w.Body.String(), `"temperature_2m":18.3`) {
			t.Fatalf("response: %d %s", w.Code, w.Body.String())
		}
	}
	if calls != 1 {
		t.Fatalf("cache missed: %d calls", calls)
	}
	for key, entry := range a.cache {
		entry.At = time.Now().Add(-16 * time.Minute)
		a.cache[key] = entry
	}
	a.current(httptest.NewRecorder(), httptest.NewRequest("GET", "/?latitude=39.9&longitude=116.4", nil))
	if calls != 2 {
		t.Fatal("expired cache reused")
	}
}

func TestWeatherUpstreamFailures(t *testing.T) {
	for _, body := range []string{`null`, `{}`, `{"current":{"time":1,"temperature_2m":null,"weather_code":0}}`, `{"error":true}`, `<html>failure</html>`} {
		t.Run(body, func(t *testing.T) {
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte(body)) }))
			defer upstream.Close()
			a := newWeatherAPI()
			a.forecastURL = upstream.URL
			w := httptest.NewRecorder()
			a.current(w, httptest.NewRequest("GET", "/?latitude=0&longitude=0", nil))
			if w.Code != 502 || len(a.cache) != 0 {
				t.Fatalf("invalid response accepted: %d", w.Code)
			}
		})
	}
}

func TestWeatherLocationSearch(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("name") != "北京" || r.URL.Query().Get("language") != "zh" {
			t.Error("incorrect search query")
		}
		w.Write([]byte(`{"results":[{"name":"北京","latitude":39.9,"longitude":116.4}]}`))
	}))
	defer upstream.Close()
	a := newWeatherAPI()
	a.searchURL = upstream.URL
	w := httptest.NewRecorder()
	a.locations(w, httptest.NewRequest("GET", "/?q=%E5%8C%97%E4%BA%AC", nil))
	if w.Code != 200 || !strings.Contains(w.Body.String(), "北京") {
		t.Fatalf("search: %d %s", w.Code, w.Body.String())
	}
}
