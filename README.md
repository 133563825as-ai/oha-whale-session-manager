# 哦鲸鲸会话管理插件

`dsh-session-manager` 是一个 DeepSeek Harness 可安装插件，用于管理归档会话、工作区筛选和文件系统回收站。

## 功能

- 查看归档会话
- 查看最后一问一答预览
- 归档会话恢复到侧边栏（取消归档）
- 工作区筛选（自动识别 DSH 已注册工作区）
- 时间筛选（最近一天 / 最近七天 / 更早）
- 下拉或按钮手动刷新，首次加载后不自动覆盖旧数据
- 单个或批量移动到回收站
- 恢复回收站会话（单个或批量）
- 单个或批量彻底删除，不可恢复
- 清空回收站并永久删除
- 清理失效记录（孤儿会话、失效归档 / 工作区记账 / 投影缓存）

## 安装

```sh
dsh plugin --profile web add ./dsh-session-manager
```

## 语义

删除会话先移动到回收站；清空回收站后无法恢复。正在打开的会话不能删除。插件不修改会话日志内容。

删除一个会话会连带它的子代理会话（`parentSession` 血缘）一起移入回收站，避免子会话日志被留在磁盘上、以无标题条目回到侧边栏。删除同时清理三层记账：归档集、每个工作区的会话记账、以及持久化投影检查点——任何一层残留都会让已删除的会话重新出现在侧边栏。

「清理失效记录」是兜底维护：扫描并移除祖先已不存在的孤儿子会话（移入回收站，可恢复），以及无法再解析到会话的失效归档 id、工作区记账和投影缓存。即使会话是被插件之外的路径删除的，也可以用它扫干净。

## 开发

```sh
npm test
npm run check
```

## 主机路由

- `GET /session-manager/archives`
- `GET /session-manager/workspaces`
- `GET /session-manager/trash`
- `POST /session-manager/trash` with `{ ids: string[] }`
- `POST /session-manager/unarchive` with `{ ids: string[] }`
- `POST /session-manager/restore` with `{ ids: string[] }`
- `POST /session-manager/purge` with `{ ids?: string[] }`
- `POST /session-manager/cleanup`

Source, tests, and documentation use no emoji.
