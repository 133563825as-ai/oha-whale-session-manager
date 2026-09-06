# dsh-session-manager

`dsh-session-manager` is an installable DeepSeek Harness bundle for managing archived sessions and a filesystem recycle bin.

## 功能

- 查看归档会话
- 查看最后一问一答预览
- 归档会话恢复到侧边栏（取消归档）
- 工作区目录（自动识别 DSH 已注册工作区）
- 时间筛选（一天内 / 七天内 / 七天以外）
- 下拉或按钮手动刷新，首次加载后不自动覆盖旧数据
- 单个或批量移动到回收站
- 恢复回收站会话
- 清空回收站并永久删除

## 安装

```sh
dsh plugin --profile web add ./dsh-session-manager
```

## 语义

删除会话先移动到回收站；清空回收站后无法恢复。正在打开的会话不能删除。插件不修改会话日志内容。

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

Source, tests, and documentation use no emoji.
