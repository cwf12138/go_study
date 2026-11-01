# SQLite 隔离实验

这里是路线图 D-05 的验证原型，不是正式后端。主项目的 `go.mod`、`cmd/api` 启动和 JSON 存储方式保持原样。

需要 Go **1.25+**，使用锁定的 `modernc.org/sqlite v1.59.0`，无需 CGO 或本机 SQLite 安装。驱动与间接依赖只在这个嵌套模块中；Go 1.22 主项目不会因此引入 SQLite 依赖。

从项目根目录执行隔离演练：

```powershell
./scripts/verify-sqlite-lab.ps1
```

报告在 `.local/checks/sqlite-lab-report.json`。脚本只生成临时测试账号与数据，覆盖转换、选定仓储契约、事务回滚、幂等、并发冲突、在线副本、强制终止进程后的恢复。没有读取正式 `DATA_FILE`，也不做断电或真机测试。

命令入口：

```powershell
go -C experiments/sqlite run ./cmd/sqlite-lab help
go -C experiments/sqlite run ./cmd/sqlite-lab inventory
```

包含两份迁移清单：6 个集合已有关系结构映射，其他集合仍只保存在原始快照归档；当前根仓储共 138 个方法，原型匹配实现 7 个。它不能替换整个 `store.Repository`，也没有正式存储切换开关。

完整用法、验收结果与剩余工作见 [SQLite 原型说明](../../docs/sqlite-prototype.md) 和 [生成的迁移清单](../../docs/sqlite-migration-inventory.json)。
