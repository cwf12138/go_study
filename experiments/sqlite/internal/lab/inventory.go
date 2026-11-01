package lab

import (
	"context"
	"reflect"
	"sort"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/store"
)

type MethodCoverage struct {
	Name   string `json:"name"`
	Status string `json:"status"`
}
type Inventory struct {
	SchemaVersion      int              `json:"schema_version"`
	ContractMethods    int              `json:"contract_methods"`
	Implemented        int              `json:"implemented"`
	Methods            []MethodCoverage `json:"methods"`
	Collections        []Coverage       `json:"collections"`
	AllModulesMigrated bool             `json:"all_modules_migrated"`
}

// Inventory is generated from the current root Repository interface, rather than
// a hand-maintained claim that a partial prototype can replace the whole app.
func MigrationInventory() Inventory {
	contract := reflect.TypeOf((*store.Repository)(nil)).Elem()
	implementation := reflect.TypeOf((*Lab)(nil))
	out := Inventory{SchemaVersion: 1, ContractMethods: contract.NumMethod(), Methods: []MethodCoverage{}, Collections: []Coverage{}}
	for i := 0; i < contract.NumMethod(); i++ {
		m := contract.Method(i)
		row := MethodCoverage{Name: m.Name, Status: "pending"}
		if candidate, ok := implementation.MethodByName(m.Name); ok && sameSignature(m.Type, candidate.Type) {
			row.Status = "prototype_implemented"
			out.Implemented++
		}
		out.Methods = append(out.Methods, row)
	}
	sort.Slice(out.Methods, func(i, j int) bool { return out.Methods[i].Name < out.Methods[j].Name })
	memory := store.NewMemory()
	memory.CreateUser(context.Background(), domain.User{ID: "inventory-only", Email: "inventory@example.test"})
	usage, err := memory.AccountUsage(context.Background(), "inventory-only")
	if err != nil {
		panic(err)
	}
	keys := []string{"users"}
	for _, c := range usage.Collections {
		key := c.Key
		if key == "memos" {
			key = "memo_notes"
		}
		keys = append(keys, key)
	}
	for _, key := range keys {
		row := Coverage{Section: key, Mode: "archive_only"}
		if table, ok := mappedSections[key]; ok {
			row.Mode = "relational_and_archive"
			row.Table = table
		}
		out.Collections = append(out.Collections, row)
	}
	out.Collections = append(out.Collections, Coverage{Section: "knowledge_memo_migrations", Mode: "archive_only"})
	sort.Slice(out.Collections, func(i, j int) bool { return out.Collections[i].Section < out.Collections[j].Section })
	return out
}
func sameSignature(contract, method reflect.Type) bool {
	if method.NumIn() != contract.NumIn()+1 || method.NumOut() != contract.NumOut() || method.IsVariadic() != contract.IsVariadic() {
		return false
	}
	for i := 0; i < contract.NumIn(); i++ {
		if method.In(i+1) != contract.In(i) {
			return false
		}
	}
	for i := 0; i < contract.NumOut(); i++ {
		if method.Out(i) != contract.Out(i) {
			return false
		}
	}
	return true
}
