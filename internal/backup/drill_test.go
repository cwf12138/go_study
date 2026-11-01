package backup

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/example/studyflow/internal/datalock"
	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/event"
	"github.com/example/studyflow/internal/httpapi"
	"github.com/example/studyflow/internal/security"
	"github.com/example/studyflow/internal/service"
	"github.com/example/studyflow/internal/store"
)

// This drill uses real TCP HTTP, the real auth/services/store and temporary
// fixture accounts. It never reads the project's data/ or contacts content feeds.
func TestRestoreHTTPDrill(t *testing.T) {
	f := seed(t)
	mustCreate(t, f)
	restored := filepath.Join(f.root, "restored-http")
	r, err := Restore(f.pack, restored, true)
	if err != nil {
		t.Fatal(err)
	}
	dataFile := filepath.Join(restored, "studyflow.json")
	t.Setenv("DATA_FILE", dataFile)
	t.Setenv("FRONTEND_DIR", filepath.Join("..", "httpapi", "assets"))
	repo := store.NewMemory()
	if err := repo.LoadJSON(dataFile); err != nil {
		t.Fatal(err)
	}
	guard, err := datalock.Acquire(restored)
	if err != nil {
		t.Fatal(err)
	}
	defer guard.Close()
	tokens := security.NewTokenManager("isolated-backup-drill-key-not-production", "backup-drill", time.Hour)
	bus := event.NewBus()
	handler := httpapi.NewHandler(service.New(repo, tokens, bus), tokens, bus, slog.New(slog.NewTextHandler(io.Discard, nil)))
	server := httptest.NewServer(handler)
	defer server.Close()
	client := &http.Client{Timeout: 5 * time.Second}
	request := func(method, path, token, body string, status int) []byte {
		t.Helper()
		req, err := http.NewRequest(method, server.URL+path, strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		if body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		resp, err := client.Do(req)
		if err != nil {
			t.Fatal("isolated HTTP request failed", err)
		}
		defer resp.Body.Close()
		b, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		if err != nil {
			t.Fatal(err)
		}
		if resp.StatusCode != status {
			t.Fatalf("%s %s: status %d, expected %d", method, path, resp.StatusCode, status)
		}
		return b
	}
	login := func(email string) string {
		b, _ := json.Marshal(map[string]string{"email": email, "password": f.password})
		data := request("POST", "/api/v1/auth/login", "", string(b), 200)
		var result struct {
			Data struct {
				Token string `json:"token"`
			} `json:"data"`
		}
		if err := json.Unmarshal(data, &result); err != nil || result.Data.Token == "" {
			t.Fatal("restored login failed")
		}
		return result.Data.Token
	}
	alice, bob := login("alice@example.test"), login("bob@example.test")
	request("GET", "/api/v1/memos/memo-alice", "", "", 401)
	note := request("GET", "/api/v1/memos/memo-alice", alice, "", 200)
	for _, s := range []string{"中文笔记", "folder-alice", "核对字段"} {
		if !bytes.Contains(note, []byte(s)) {
			t.Fatal("restored memo fields differ")
		}
	}
	request("GET", "/api/v1/memos/memo-alice", bob, "", 403)
	if b := request("GET", "/api/v1/memos?view=trash", alice, "", 200); !bytes.Contains(b, []byte("trash-memo")) {
		t.Fatal("trash unavailable after restore")
	}
	if b := request("GET", "/api/v1/tasks", alice, "", 200); !bytes.Contains(b, []byte(`"goal_id":"goal-alice"`)) {
		t.Fatal("task/goal reference differs")
	}
	if b := request("GET", "/api/v1/todos", alice, "", 200); !bytes.Contains(b, []byte(`"list_id":"list-alice"`)) {
		t.Fatal("todo/list reference differs")
	}
	start, end := time.Now().AddDate(0, 0, -1).Format("2006-01-02"), time.Now().AddDate(0, 0, 8).Format("2006-01-02")
	if b := request("GET", "/api/v1/calendar?start="+start+"&end="+end, alice, "", 200); !bytes.Contains(b, []byte("event-alice")) {
		t.Fatal("restored calendar event unavailable")
	}
	for _, c := range []struct{ token, want string }{{alice, "ALICE_ATTACHMENT_内容"}, {bob, "BOB_ATTACHMENT_内容"}} {
		b := request("GET", "/api/v1/transfers/upload-live/content", c.token, "", 200)
		if string(b) != c.want {
			t.Fatal("cross-account attachment content differs")
		}
	}
	request("GET", "/api/v1/transfers/upload-trash/content", alice, "", 410)
	listing := request("GET", "/api/v1/transfers", alice, "", 200)
	if !bytes.Contains(listing, []byte("upload-trash")) || bytes.Contains(listing, []byte(`"missing":true`)) {
		t.Fatal("restored attachment state differs")
	}
	clipBytes := request("GET", "/api/v1/text-clips", alice, "", 200)
	if bytes.Contains(clipBytes, []byte("BOB_PRIVATE_CLIP")) {
		t.Fatal("cross-account text leak")
	}
	var clips struct {
		Data []domain.TextClip `json:"data"`
	}
	if err := json.Unmarshal(clipBytes, &clips); err != nil || len(clips.Data) != 1 || !clips.Data[0].Deleted || !clips.Data[0].ExpiresAt.Before(time.Now()) || clips.Data[0].Text != "ALICE_PRIVATE_CLIP" {
		t.Fatal("expired/trash clip fields differ after HTTP restore")
	}
	created := request("POST", "/api/v1/memos", alice, `{"title":"恢复后新建","content":"可以继续使用","color":"default"}`, 201)
	var result struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(created, &result); err != nil || result.Data.ID == "" {
		t.Fatal("new record failed")
	}
	server.Close()
	if err := repo.SaveJSON(dataFile); err != nil {
		t.Fatal(err)
	}
	restarted := store.NewMemory()
	if err := restarted.LoadJSON(dataFile); err != nil {
		t.Fatal(err)
	}
	// Read through a fresh handler/repository after an explicit snapshot save.
	newServer := httptest.NewServer(httpapi.NewHandler(service.New(restarted, tokens, bus), tokens, bus, slog.New(slog.NewTextHandler(io.Discard, nil))))
	defer newServer.Close()
	oldServer := server
	server = newServer
	request("GET", "/api/v1/memos/"+result.Data.ID, alice, "", 200)
	server = oldServer
	if !bytes.Equal(read(t, f.source), f.snapshot) {
		t.Fatal("drill modified source")
	}
	// Report only this fixture drill, never the user's real backup or a device.
	summary := map[string]any{"schema_version": 1, "fixtures_only": true, "checked_at": time.Now().UTC(), "backup_id": r.BackupID, "production_changed": false, "checks": map[string]bool{"two_account_login": true, "account_isolation": true, "task_goal_reference": true, "todo_list_reference": true, "memo_folder_and_body": true, "trash_and_expired_retained": true, "calendar_event": true, "attachment_download": true, "new_write_after_restore": true, "restart_after_snapshot": true}, "android_device_verified": false}
	b, _ := json.Marshal(summary)
	t.Log("D04_FIXTURE_DRILL " + string(b))
}
