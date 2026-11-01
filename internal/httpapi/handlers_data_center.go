package httpapi

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/example/studyflow/internal/store"
	"github.com/example/studyflow/internal/transfers"
)

type dataRecords struct {
	State string `json:"state"`
	store.AccountUsage
}
type dataAttachments struct {
	State          string `json:"state"`
	Files          int    `json:"files"`
	Active         int    `json:"active"`
	Expired        int    `json:"expired"`
	Trashed        int    `json:"trashed"`
	Missing        int    `json:"missing"`
	AccountedBytes int64  `json:"accounted_bytes"`
	MaxBytes       int64  `json:"max_bytes"`
	MaxFiles       int    `json:"max_files"`
}

func (s *Server) dataCenter(w http.ResponseWriter, r *http.Request) {
	user := claimsFromContext(r.Context()).Subject
	usage, available, err := s.service.AccountUsage(r.Context(), user)
	records := dataRecords{State: "unavailable", AccountUsage: store.AccountUsage{Collections: []store.CollectionUsage{}}}
	if err == nil && available {
		records.State = "available"
		records.AccountUsage = usage
	}
	attachments := dataAttachments{State: "unavailable", MaxBytes: transfers.MaxAccountBytes, MaxFiles: transfers.MaxFiles}
	if s.localOnlyTransfers && !loopbackRequest(r) {
		attachments.State = "local_only"
	} else if listing, e := s.transfers.List(r.Context(), user); e == nil {
		attachments.State = "available"
		attachments.Files = len(listing.Items)
		attachments.AccountedBytes = listing.UsedBytes
		for _, row := range listing.Items {
			if row.DeletedAt != nil {
				attachments.Trashed++
			} else if row.Expired {
				attachments.Expired++
			} else {
				attachments.Active++
			}
			if row.Missing {
				attachments.Missing++
			}
		}
	}
	writeJSON(w, 200, envelope{"data": envelope{"schema_version": 1, "checked_at": time.Now().UTC(), "scope": "current_account", "records": records, "attachments": attachments, "personal_json_includes_attachments": false, "full_backup_restore_verified": false}})
}

func (s *Server) checkTransferIntegrity(w http.ResponseWriter, r *http.Request) {
	report, err := s.transfers.CheckIntegrity(r.Context(), claimsFromContext(r.Context()).Subject)
	if err != nil {
		status, code, message := 500, "integrity_unavailable", "暂时无法完成附件检查；没有修改任何文件，请稍后重试。"
		switch {
		case errors.Is(err, transfers.ErrBusy):
			status, code, message = 429, "integrity_busy", "服务正在检查附件，请稍后再试。"
			w.Header().Set("Retry-After", "5")
		case errors.Is(err, transfers.ErrQuota):
			status, code, message = 422, "integrity_scope_limit", "附件索引超过在线检查范围，请在电脑端使用离线备份校验。"
		case errors.Is(err, context.Canceled), errors.Is(err, context.DeadlineExceeded):
			status, code, message = 408, "integrity_cancelled", "附件检查已取消或超时，没有修改任何文件。"
		}
		writeJSON(w, status, envelope{"error": envelope{"code": code, "message": message}})
		return
	}
	writeJSON(w, 200, envelope{"data": report})
}
