package httpapi

import (
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Weather is an optional integration: failure never prevents the app from starting.
type weatherAPI struct {
	client                 *http.Client
	forecastURL, searchURL string
	mu                     sync.Mutex
	cache                  map[string]weatherCache
}
type weatherCache struct {
	Data json.RawMessage
	At   time.Time
}

func newWeatherAPI() *weatherAPI {
	return &weatherAPI{client: &http.Client{Timeout: 10 * time.Second}, forecastURL: "https://api.open-meteo.com/v1/forecast", searchURL: "https://geocoding-api.open-meteo.com/v1/search", cache: make(map[string]weatherCache)}
}

func weatherError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, envelope{"error": envelope{"message": message}})
}

func (a *weatherAPI) current(w http.ResponseWriter, r *http.Request) {
	lat, e1 := strconv.ParseFloat(r.URL.Query().Get("latitude"), 64)
	lon, e2 := strconv.ParseFloat(r.URL.Query().Get("longitude"), 64)
	if e1 != nil || e2 != nil || math.IsNaN(lat) || math.IsNaN(lon) || math.IsInf(lat, 0) || math.IsInf(lon, 0) || lat < -90 || lat > 90 || lon < -180 || lon > 180 {
		weatherError(w, 400, "请提供有效的经纬度")
		return
	}
	q := url.Values{"latitude": {fmt.Sprintf("%.3f", lat)}, "longitude": {fmt.Sprintf("%.3f", lon)}, "current": {"temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,is_day,wind_speed_10m"}, "daily": {"temperature_2m_max,temperature_2m_min"}, "forecast_days": {"1"}, "timezone": {"auto"}, "timeformat": {"unixtime"}}
	a.fetch(w, r, a.forecastURL+"?"+q.Encode(), 15*time.Minute, true)
}

func (a *weatherAPI) locations(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimSpace(r.URL.Query().Get("q"))
	if len([]rune(name)) < 2 || len([]rune(name)) > 80 {
		weatherError(w, 400, "请输入 2–80 个字符的城市名称")
		return
	}
	q := url.Values{"name": {name}, "count": {"8"}, "language": {"zh"}, "format": {"json"}}
	a.fetch(w, r, a.searchURL+"?"+q.Encode(), time.Hour, false)
}

func (a *weatherAPI) fetch(w http.ResponseWriter, r *http.Request, endpoint string, ttl time.Duration, forecast bool) {
	w.Header().Set("Cache-Control", "no-store")
	a.mu.Lock()
	cached, ok := a.cache[endpoint]
	a.mu.Unlock()
	if ok && time.Since(cached.At) < ttl {
		writeJSON(w, 200, envelope{"data": cached.Data})
		return
	}
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, endpoint, nil)
	if err != nil {
		weatherError(w, 502, "天气服务暂时不可用")
		return
	}
	req.Header.Set("User-Agent", "StudyFlow/1.0")
	resp, err := a.client.Do(req)
	if err != nil {
		weatherError(w, 502, "无法连接天气服务，请稍后重试或检查服务器网络")
		return
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, (1<<20)+1))
	if err != nil || len(data) > 1<<20 || resp.StatusCode != 200 || !validWeatherResponse(data, forecast) {
		weatherError(w, 502, "天气服务未返回有效数据，请稍后重试")
		return
	}
	a.mu.Lock()
	// Bounded cache prevents arbitrary location searches from growing memory forever.
	if len(a.cache) >= 128 {
		for key := range a.cache {
			delete(a.cache, key)
			break
		}
	}
	a.cache[endpoint] = weatherCache{Data: json.RawMessage(data), At: time.Now()}
	a.mu.Unlock()
	writeJSON(w, 200, envelope{"data": json.RawMessage(data)})
}

func validWeatherResponse(data []byte, forecast bool) bool {
	var object map[string]json.RawMessage
	if json.Unmarshal(data, &object) != nil || object == nil {
		return false
	}
	if !forecast {
		if results, exists := object["results"]; exists {
			var locations []struct {
				Name string `json:"name"`
			}
			if json.Unmarshal(results, &locations) != nil {
				return false
			}
		}
	}
	var payload struct {
		Error   bool `json:"error"`
		Current *struct {
			Time        *int64   `json:"time"`
			Temperature *float64 `json:"temperature_2m"`
			Code        *int     `json:"weather_code"`
		} `json:"current"`
	}
	if json.Unmarshal(data, &payload) != nil || payload.Error {
		return false
	}
	return !forecast || (payload.Current != nil && payload.Current.Time != nil && payload.Current.Temperature != nil && payload.Current.Code != nil)
}
