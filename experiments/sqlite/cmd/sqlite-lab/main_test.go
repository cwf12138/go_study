package main

import (
	"bytes"
	"encoding/json"
	"testing"
)

func TestCLIExplicitScopeAndNoProductionSwitch(t *testing.T) {
	for _, args := range [][]string{{"convert"}, {"convert", "--backup", "x"}, {"convert", "--data-file", "data/studyflow.json"}, {"inspect"}, {"backup", "--lab", "x"}, {"serve"}, {"convert", "--force"}} {
		var out, errOut bytes.Buffer
		if code := run(args, &out, &errOut); code != 2 {
			t.Fatal("unsafe/missing flags accepted", args, code)
		}
	}
	var out, errOut bytes.Buffer
	if code := run([]string{"inventory"}, &out, &errOut); code != 0 {
		t.Fatal(errOut.String())
	}
	var result struct {
		OK   bool
		Data struct {
			Implemented        int
			AllModulesMigrated bool `json:"all_modules_migrated"`
		}
	}
	if json.Unmarshal(out.Bytes(), &result) != nil || !result.OK || result.Data.Implemented != 7 || result.Data.AllModulesMigrated {
		t.Fatal("inventory result invalid")
	}
}
