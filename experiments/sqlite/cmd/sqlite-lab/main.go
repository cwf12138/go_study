package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"

	"github.com/example/studyflow/experiments/sqlite/internal/lab"
)

const usage = `Daynest SQLite 隔离原型（不接入正式服务）

在 experiments/sqlite 目录运行：
  go run ./cmd/sqlite-lab inventory
  go run ./cmd/sqlite-lab convert --backup <完整备份目录> --output <全新实验目录>
  go run ./cmd/sqlite-lab convert --backup <完整备份目录> --output <全新实验目录> --apply
  go run ./cmd/sqlite-lab inspect --lab <实验目录>
  go run ./cmd/sqlite-lab backup --lab <实验目录> --output <全新数据库副本目录>

convert 默认只预览，不写数据库。只接受经校验的完整备份，忽略 DATA_FILE。
本原型只映射部分集合；完整原始快照另存于数据库，附件不会复制进去。
生成的数据库及副本含账号、密码哈希与正文，未加密，请私密保存。
没有覆盖、切换正式存储或启动 HTTP 服务的命令。需要 Go 1.25+，无需 CGO。
`

func run(args []string, out, errOut io.Writer) int {
	if len(args) == 0 || args[0] == "help" || args[0] == "--help" {
		fmt.Fprint(out, usage)
		return 0
	}
	command := args[0]
	if command != "inventory" && command != "convert" && command != "inspect" && command != "backup" {
		fmt.Fprint(errOut, usage)
		return 2
	}
	flags := flag.NewFlagSet(command, flag.ContinueOnError)
	flags.SetOutput(errOut)
	var input, output *string
	var apply *bool
	switch command {
	case "convert":
		input = flags.String("backup", "", "已验证的完整服务备份目录")
		output = flags.String("output", "", "全新实验目录")
		apply = flags.Bool("apply", false, "实际写入独立数据库")
	case "inspect":
		input = flags.String("lab", "", "有原型标记的实验目录")
	case "backup":
		input = flags.String("lab", "", "实验目录")
		output = flags.String("output", "", "全新数据库副本目录")
	}
	if err := flags.Parse(args[1:]); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return 0
		}
		return 2
	}
	if flags.NArg() != 0 || (input != nil && *input == "") || (output != nil && *output == "") {
		fmt.Fprintln(errOut, "缺少明确的输入 / 输出目录，请运行 help。")
		return 2
	}
	ctx := context.Background()
	var value any
	var err error
	switch command {
	case "inventory":
		value = lab.MigrationInventory()
	case "convert":
		var source *lab.Source
		source, err = lab.ReadSource(*input)
		if err == nil {
			var plan lab.Plan
			plan, err = lab.Convert(ctx, source, *output, *apply)
			op := "preview"
			if *apply {
				op = "convert"
			}
			value = map[string]any{"operation": op, "plan": plan, "database_written": *apply && err == nil}
		}
	case "inspect":
		var database *lab.Lab
		database, err = lab.Open(ctx, *input, true)
		if err == nil {
			value, err = database.Inspect(ctx)
			closeErr := database.Close()
			if err == nil {
				err = closeErr
			}
		}
	case "backup":
		var database *lab.Lab
		database, err = lab.Open(ctx, *input, false)
		if err == nil {
			value, err = database.Backup(ctx, *output)
			closeErr := database.Close()
			if err == nil {
				err = closeErr
			}
		}
	}
	enc := json.NewEncoder(out)
	enc.SetIndent("", "  ")
	if err != nil {
		fmt.Fprintln(errOut, "原型操作未完成：", err)
		enc.Encode(map[string]any{"ok": false, "operation": command, "code": "sqlite_lab_failed", "production_changed": false})
		return 1
	}
	if err := enc.Encode(map[string]any{"ok": true, "data": value, "production_changed": false}); err != nil {
		return 1
	}
	return 0
}
func main() { os.Exit(run(os.Args[1:], os.Stdout, os.Stderr)) }
