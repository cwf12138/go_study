// Daynest's complete service backup is an offline owner-only CLI, never a
// general authenticated HTTP endpoint. All restore destinations must be new.
package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"

	"github.com/example/studyflow/internal/backup"
)

const usage = `Daynest 完整服务备份（本地工具，不上传数据）

  go run ./cmd/backup create --data-file <快照路径> --output <全新备份目录> --service-stopped
  go run ./cmd/backup verify --input <备份目录>
  go run ./cmd/backup restore --input <备份目录> --output <全新恢复目录>
  go run ./cmd/backup restore --input <备份目录> --output <全新恢复目录> --apply

restore 默认仅预览，--apply 才写入。不会覆盖已有目录、切换正式数据或启动服务。
备份包含所有账号及密码哈希、快传文件，未加密；只应保存在你控制的私密目录。
create 前正常停止 Go 服务。旧版服务不支持互斥锁，必须自行确认已退出。
以上命令均支持 --json 输出不含正文、账号标识或绝对路径的结果。
`

func run(args []string, out, errOut io.Writer) int {
	if len(args) == 0 || args[0] == "help" || args[0] == "--help" || args[0] == "-h" {
		fmt.Fprint(out, usage)
		return 0
	}
	command := args[0]
	if command != "create" && command != "verify" && command != "restore" {
		fmt.Fprint(errOut, usage)
		return 2
	}
	flags := flag.NewFlagSet(command, flag.ContinueOnError)
	flags.SetOutput(errOut)
	asJSON := flags.Bool("json", false, "输出脱敏 JSON 结果")
	var input, output, dataFile *string
	var apply, stopped *bool
	switch command {
	case "create":
		dataFile = flags.String("data-file", "", "明确指定 DATA_FILE")
		output = flags.String("output", "", "全新备份目录（父目录须存在）")
		stopped = flags.Bool("service-stopped", false, "确认旧服务也已正常退出")
	case "verify":
		input = flags.String("input", "", "备份目录")
	case "restore":
		input = flags.String("input", "", "备份目录")
		output = flags.String("output", "", "全新恢复目录（父目录须存在）")
		apply = flags.Bool("apply", false, "完成校验后实际写入新目录")
	}
	if err := flags.Parse(args[1:]); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return 0
		}
		return 2
	}
	if flags.NArg() != 0 || (input != nil && *input == "") || (output != nil && *output == "") || (dataFile != nil && *dataFile == "") {
		fmt.Fprintln(errOut, "缺少必要路径参数；请运行 go run ./cmd/backup help 查看用法。")
		return 2
	}
	var report backup.Report
	var err error
	switch command {
	case "create":
		report, err = backup.Create(*dataFile, *output, *stopped)
	case "verify":
		report, err = backup.Verify(*input)
	case "restore":
		report, err = backup.Restore(*input, *output, *apply)
	}
	if err != nil {
		// Raw local errors aid the owner, but never enter the shareable JSON.
		fmt.Fprintln(errOut, "操作未完成：", err)
		if *asJSON {
			json.NewEncoder(out).Encode(map[string]any{"ok": false, "operation": command, "code": "backup_operation_failed", "production_changed": false})
		}
		return 1
	}
	if *asJSON {
		e := json.NewEncoder(out)
		e.SetIndent("", "  ")
		if e.Encode(map[string]any{"ok": true, "data": report}) != nil {
			return 1
		}
		return 0
	}
	label := map[string]string{"create": "备份副本已创建并校验", "verify": "备份内容校验通过", "restore_preview": "恢复预览通过，尚未写入；添加 --apply 执行", "restore": "已恢复到全新目录并逐文件回读校验"}[report.Operation]
	fmt.Fprintf(out, "%s\n备份标识：%s\n%d 个文件 / %d 字节 / %d 个账号 / %d 个快传记录\n", label, report.BackupID, report.Files, report.Bytes, report.Snapshot.Accounts, report.Transfers.Files)
	for _, w := range report.Warnings {
		label := map[string]string{
			"rolling_backup_invalid_preserved":      "滚动 .bak 无效，已原样保留；主快照有效，本工具未自动选择旧版本",
			"historical_references_need_review":     "部分历史记录的引用目标已不存在，已原样保留，请在恢复副本中核对",
			"unreferenced_transfer_files_preserved": "发现无元数据引用的快传文件或中断状态文件，已原样保留",
			"source_transfer_directory_was_absent":  "源快传目录不存在，按空目录复制；无法判断此前是否曾丢失文件",
		}[w]
		if label == "" {
			label = w
		}
		fmt.Fprintln(out, "需核对：", label)
	}
	fmt.Fprintln(out, "正式数据未切换；内容校验不代表应用登录、附件下载或真机验收已通过。")
	return 0
}

func main() { os.Exit(run(os.Args[1:], os.Stdout, os.Stderr)) }
