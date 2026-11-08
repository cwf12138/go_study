package service

import "github.com/example/studyflow/internal/store"

type writeObserver interface {
	BeginWriteObservation(string) (string, error)
	ObserveWrite(string, string) (string, error)
	WriteReceiptStatuses(string, []string) []store.WriteReceiptStatus
}

func (s *Service) BeginWriteObservation(user string) string {
	if observer, ok := s.repo.(writeObserver); ok {
		value, err := observer.BeginWriteObservation(user)
		if err == nil {
			return value
		}
	}
	return ""
}
func (s *Service) ObserveWrite(user, epoch string) string {
	if observer, ok := s.repo.(writeObserver); ok {
		value, err := observer.ObserveWrite(user, epoch)
		if err == nil {
			return value
		}
	}
	return ""
}
func (s *Service) WriteReceiptStatuses(user string, receipts []string) ([]store.WriteReceiptStatus, bool) {
	if observer, ok := s.repo.(writeObserver); ok {
		return observer.WriteReceiptStatuses(user, receipts), true
	}
	rows := make([]store.WriteReceiptStatus, 0, len(receipts))
	for _, receipt := range receipts {
		rows = append(rows, store.WriteReceiptStatus{Receipt: receipt, State: "unverifiable"})
	}
	return rows, false
}
