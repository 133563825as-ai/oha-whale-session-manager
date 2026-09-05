# 会话管理面板（dsh-session-manager）设计

日期：2026-09-05 · 目标运行时：DSH 0.1.1-rc.2（DSHA / Android 容器，Web UI）

## 背景

DSH 的侧边栏已经能新建、切换、搜索、重命名、分叉、归档会话，但归档之后那些会话就只是从列表里消失了——没有地方回看它们，也没有任何删除入口。框架本身**没有提供删除会话的 API**（`dsh-session-persistence` 的文档明确写了「无删除或保留接口」），所以这件事只能由插件自己动磁盘完成。

本插件补上这段：一个居中模态弹窗，里面管归档会话的回看与删除，删除经过回收站兜底。

## 目标

- 侧边栏底部一个入口，打开居中模态弹窗。
- 弹窗内「归档」页：列出全部归档会话，每条带标题、最后活动时间、最后一问一答预览。
- 单条删除；进入勾选模式后可多选、可全选，一次性删除。
- 弹窗内「回收站」页：列出已删会话，可单条恢复，可彻底清空。
- 删除是搬进回收站，不是立刻销毁；只有清空回收站才真正删磁盘文件。

## 非目标

- 不改动现有归档行为，不接管侧边栏会话列表。
- 不做标签、收藏、分组、批量归档。
- 不做未归档会话的管理（那是侧边栏已有的职责）。
- 不显示 token 消耗、不做压缩控制、不做对话回撤——各自是独立插件。

## 用户可见行为

### 入口

侧边栏底部动作区（`sidebar.footer.action`，list 型座位）新增一个按钮，图标 + 文字「会话管理」。该座位会把侧边栏的折叠状态传进来，所以按钮有两个形态：展开时图标 + 文字，折叠成图标栏时只留图标并带 tooltip。以后的「压缩会话」插件挨着它注册第二个条目，两者并排，互不依赖。

### 弹窗形态

注册到全屏浮层座位（`shell.overlay`，list 型，默认点击穿透，本条目显式开启指针事件）。

- 位置：屏幕正中。
- 遮罩：半透明暗色铺满视口，吞掉底层所有点击与滑动手势；弹窗打开期间背景不可操作。
- 关闭：右上角 ×、Android 返回键、点击遮罩，三者等效。删除动作本身有二次确认，所以误关不会造成数据损失。
- 尺寸（适中，不占满屏）：
  - 手机竖屏：宽 `min(92vw, 400px)`，高 `min(58vh, 480px)`。
  - 桌面：宽 400px，高 480px。
  - 列表区在弹窗内部滚动，一屏露出 4～5 条。

### 归档页

每行结构：

```
标题（单行截断）                       3 天前
  你：<最后一条用户消息，最多两行>
  AI：<最后一条助手回复，最多两行>           [删除]
```

- 行高约 76px。点标题区域展开该行，预览放宽到最多各四行；再点收起。
- 右侧删除按钮 = 单条删除，弹二次确认。图标用线性描边图形，不用 emoji。
- 顶部「选择」进入勾选模式：每行左侧出现复选框，顶部出现「全选 / 取消全选」和「删除所选（N）」。批量删除同样二次确认，确认文案里带条数。
- 列表默认按最后活动时间倒序。
- 空状态：「还没有归档的会话」。

### 回收站页

每行显示标题、删除时间、同样的一问一答预览。

- 单条「恢复」：搬回原位，会话重新出现在归档名单里（保持归档状态，不自动取消归档）。
- 顶部「清空回收站」：二次确认，文案明确写「彻底删除，无法恢复」，确认后真删文件。
- 空状态：「回收站是空的」。

## 架构

两侧插件。客户端负责全部 UI 与列表拼装，主机负责一切碰磁盘的事。

### 客户端（`client/client.js`）

| 需要的数据 | 来源 |
| --- | --- |
| 归档会话 id 名单 | `useWorkspaces(s => s.archivedSessionIds)`——主机侧持久化的全局归档集合，不是浏览器本地存储 |
| 标题、最后活动时间、是否当前打开 | `useSessions(...)` 的会话列表状态 |
| 一问一答预览 | 主机接口（客户端拿不到文件） |
| 删除 / 恢复 / 清空 / 回收站列表 | 主机接口 |

座位注册沿用仓库内已验证的写法（`dsha-api-dashboard/client/client.js` 与 `dsha-web-mobile/lib/client.js` 是现成模板）：

```js
ctx.slots.inject("<座位名>", () => ctx.slots.register({
  name: "<座位名>", id: "dsh-session-manager", order: 10, locale: NS,
}, Component))
```

弹窗开关状态放插件自己的客户端 store，不进会话日志。

### 主机（`src/index.js`）

用 `ctx.inject(['webServer'], …)` + `webServer.register({kind:'prefix', path:'/session-manager/…'})` 开一组小接口（`/api` 前缀是框架 RPC 保留区，不能用）：

| 接口 | 作用 |
| --- | --- |
| `GET  …/preview?ids=a,b,c` | 批量返回每个会话的最后一问一答（截断后的纯文本）+ 最后活动时间 |
| `POST …/trash` | 把指定会话搬进回收站 |
| `GET  …/trash` | 列出回收站内容 |
| `POST …/restore` | 把回收站里的会话搬回原位 |
| `POST …/purge` | 彻底删除回收站内容 |

预览实现：流式解压 `session.jsonl.zstd`，只取尾部若干条 `user/message` 与 `assistant/message` 事件的文本块，截断后返回。不整份解压、不缓存正文。

### 磁盘布局

会话真实路径：`~/.dsh/sessions/--<归一化 cwd>--/<sessionId>/session.jsonl.zstd`（`~/.dsh/sessions` 是指向 `/sdcard/Documents/dshdata/sessions` 的符号链接）。

回收站放在**会话目录树之外**，避免被框架的会话扫描逻辑看见：

```
~/.dsh/storages/dsh-session-manager/trash/<sessionId>/
    session.jsonl.zstd
    manifest.json      # { sessionId, originalDir, title, deletedAt }
```

`~/.dsh/storages` 同样指向 `/sdcard/Documents/dshdata/storages`，与 sessions 同一个存储卷，所以搬移是 `rename` 级操作：瞬间完成、不复制、不额外占空间。恢复时读 `manifest.json` 里的 `originalDir` 搬回去。

## 安全边界

- **当前打开的会话不允许删除**，按钮置灰并给出提示；先切走再删。
- 归档名单里可能存在磁盘上已不存在的 id（历史遗留），预览接口对这种返回「记录已丢失」而不是报错，并允许把它从名单里清掉。
- 主机接口只接受形如 UUID 的 sessionId，拼路径前校验，拒绝任何路径穿越。
- 插件从不读写会话文件内容，只搬目录。会话日志是只追加结构，任何就地改写都会撞上崩溃修复与持久化写缓冲。
- 清空回收站不可恢复，二次确认文案必须写明。
- 接口只监听本地回环（沿用框架 webServer 的既有暴露面），不新增对外端口。

## 验收方式

在这台真机的 DSH 上端到端跑一遍，不用单元测试代替：

1. 新建一个测试会话，说两句话，归档它。
2. 打开面板 → 归档页里能看到它，标题、时间、一问一答预览与实际对话一致。
3. 单条删除 → 从归档页消失，出现在回收站页。
4. 磁盘检查：原目录已不存在，回收站目录里有它和 `manifest.json`。
5. 恢复 → 回到归档页，磁盘回到原路径，能正常打开会话。
6. 再删 → 清空回收站 → 磁盘上确认文件真的没了。
7. 尝试删除当前打开的会话 → 被拒绝并有提示。
8. 弹窗形态：手机竖屏下尺寸适中不占满屏，遮罩挡住背景交互，三种关闭方式都有效。
9. 插件卸载后重启 DSH，侧边栏与会话功能一切正常（座位注册随 fiber 卸载自动摘除）。

## 风险与未决

- **框架无删除路径**：删除完全由本插件承担，这是设计上的既定事实，不是可以绕开的选项。回收站是唯一的兜底。
- **Android 存储层**：`/sdcard` 是模拟存储，同卷 `rename` 正常，但权限与大小写行为需在真机上实测确认（列在验收步骤 4、6）。
- **归档集合的写入方**：本插件只读归档名单、不修改它。删除后该 id 仍留在框架的归档集合里，界面上靠「磁盘不存在」过滤掉；是否需要同步把 id 从归档集合摘掉，等真机跑过之后再定——涉及调用框架的归档写接口，属于范围之外的加法。
- **预览的隐私面**：预览会读出对话正文片段并送到浏览器。仅限本机回环，且只取尾部两条、截断。

## 附录：已核实的接口出处

以下都在本机 `~/.dsh/profiles/node_modules/@deepseek-ai/` 里逐条读过，实施时不必重新调研。

| 用途 | 出处 |
| --- | --- |
| 侧边栏底部按钮座位（list / root scope，owner 带折叠状态） | `dsh-client-ui-sidebar/lib/types/client/contract/slots.d.ts:58` |
| 全屏浮层座位（list / root scope，默认点击穿透，需自行开启指针事件） | `dsh-client-ui-layout/lib/types/client/index.d.ts:77` |
| 归档 id 名单（主机侧持久化的全局集合） | `dsh-client-runtime/lib/types/client/workspaces/service.d.ts:18` |
| 全局座位标准 props（`useSessions` / `useWorkspaces`） | `dsh-client-runtime/lib/types/client/index.d.ts` 的 `GlobalStandardProps` |
| 主机 HTTP 路由注册 | `dsh-host-webserver/lib/types/index.d.ts:35`，实例见 `dsha-api-dashboard/src/index.js:1498` |
| 会话文件目录规则 | `dsh-session-persistence-jsonl/lib/types/format.d.ts:86` |
| 「无删除或保留接口」的原文 | `dsh-session-persistence/README.zh.md:83` |
| 双侧插件的包结构与 `dsh.client.inject` 写法 | `dsha-api-dashboard/package.json`、`client/client.js` |
| 座位注册与 locale 注册的实际写法 | `dsha-api-dashboard/client/client.js:2082`、`dsh-client-ui-deliverables/lib/client.js:349` |

