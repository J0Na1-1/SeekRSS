# SeekRSS

单管理员、自托管的 RSS / Atom 监控与 Telegram 推送。**Web 与 Telegram 命令修改同一套 SQLite 配置。**

基于 [ljnchn/NodeSeeker-docker](https://github.com/ljnchn/NodeSeeker-docker) 二次开发，保留原版页面布局、明暗主题和抽屉交互。原始 MIT 版权声明见 [LICENSE](LICENSE)。

> 当前为开发版源码，不是已完成全部外部验收的正式版本。真实 Telegram 投递与源站允许的持续访问频率仍需单独验证；最新验证范围见 [docs/VALIDATION.md](docs/VALIDATION.md)。

## 功能范围

- 多 RSS / Atom 源：添加、编辑、暂停、测试、首轮基线。
- 关键词、组合关键词、屏蔽词、组合屏蔽词；组合内部 AND，独立规则之间 OR，屏蔽优先。
- 单管理员 Web 登录及 Telegram 数字用户 ID 白名单，无公开注册或多用户系统。
- Web 信息流、源/规则/目标/Bot/模板/状态管理。
- Telegram `/add` 等命令与 Web 共用服务。
- 持久化逐目标发送队列、故障重试、冷却与重启恢复。
- 非 root Docker、数据持久化、默认仅监听本机。

## 速度与边界

支持将目标采集间隔设为 1 秒。**同主机最短请求间隔默认 10 秒**；管理员确认网站允许后可自行改为 1 秒。目标间隔与实际受限间隔分别展示，测试和重试同样受预算约束。重定向的每一跳都消耗对应主机的预算；网络传输（含 DNS、响应正文及各跳累计）限时 15 秒，发布方要求的间隔等待单独计时、有界且可取消，不通过缩短等待来绕过限流。

NodeSeek RSS 按实时源设计；正常工况以“条目进入 RSS 到 Telegram API 确认发送三秒内”为性能目标，**不是无条件 SLA，也不等于手机三秒显示通知**。限流、网络及发送积压可能增加延迟。

实时性不证明网站允许每秒访问；304 也可能计入额度。不使用轮换 IP、破缓存参数或验证码绕过。没有包含规则时不推送；首次成功采集默认不补发历史。暂停推送仍采集，但不补发暂停期间的新帖。

## Docker 部署

```bash
git clone https://github.com/J0Na1-1/SeekRSS.git
cd SeekRSS
docker-compose up -d --build
```

有 Compose 插件可使用 `docker compose`。默认监听服务器 `127.0.0.1:3010`。远程访问推荐 SSH 隧道：

```bash
ssh -L 3010:127.0.0.1:3010 user@your-server
```

随后在电脑访问 http://127.0.0.1:3010。公网使用应放到 HTTPS 反向代理后，设置 `COOKIE_SECURE=true` 与准确的 `PUBLIC_ORIGIN=https://你的域名或IP`；后端保持本机或私有网络监听，不要直接公开 HTTP 管理页。`PUBLIC_ORIGIN` 用于严格校验浏览器的 Origin，不信任客户端随意传入的转发头。

### 首次设置

1. 在服务器读取一次性初始化密钥，不要公开：
   ```bash
   docker-compose exec seekrss bun -e 'console.log(await Bun.file("/app/data/setup.key").text())'
   ```
2. Web 创建唯一管理员，密码至少 12 位，输入初始化密钥。
3. 在“管理 → 机器人”配置新建 Bot 的 Token 及你的 Telegram 数字用户 ID。
4. 先向 Bot 发 `/start`，再添加推送目标。
5. 添加 RSS 和规则，测试匹配及发送。

Token 在 Web 输入并加密保存，不通过聊天配置，也不会回显。不要复用其他系统正在轮询的 Bot Token。

### 忘记管理员密码

仅服务器管理员可运行 `docker-compose exec seekrss bun dist/admin-reset.js`（需要设置准确的 HTTPS `PUBLIC_ORIGIN`），生成默认 30 分钟有效的一次性链接。输出是敏感持有者链接，请私密交付本人，不要写入公开日志。链接令牌只存哈希，重新生成即作废旧链接；页面通过 URL fragment 接收并立即清除，密码由本人在 HTTPS 表单输入。重设成功原子作废链接和所有旧会话，不修改账号、订阅、规则或 Token。不要删除管理员表或用公开初始化接口绕过恢复。

## Telegram 命令

```text
/add 香港,VPS             两个独立关键词（OR）
/combo 香港,VPS           一个组合（AND）
/block 求购,已出          两个独立屏蔽词
/blockcombo 溢价,收       一个组合屏蔽规则
/list                     查看规则
/on ID /off ID /del ID    开关或删除规则
/feedadd URL              添加源
/feeds                    查看源
/feededit ID              编辑向导
/interval ID 秒数         目标间隔
/feedpause ID             暂停源
/feedresume ID            恢复源
/feeddel ID               删除源
/targets                  查看目标
/targetadd CHAT_ID 名称   添加目标
/targetdel ID             删除目标
/pause /resume            暂停 / 恢复推送
/status /history          状态 / 记录
/test 内容                测试规则
/cancel /help             取消 / 帮助
```

管理命令仅配置的管理员 ID 在私聊可用。群组/频道目标需要对应权限。支持情况以版本验证报告及 `/help` 为准。

## 数据、备份和升级

Docker 数据卷包含 SQLite、Token 加密密钥 `secret.key` 和初始化密钥 `setup.key`。加密密钥丢失将无法解密已保存 Token。

```bash
docker-compose exec seekrss bun scripts/backup.ts /app/data/backup.db
```

备份工具使用 SQLite `VACUUM INTO` 生成一致性备份。数据库和配套密钥应离线安全保存；外部 `SECRET_KEY` 需另存。备份不是公开下载文件。

恢复必须先停服务，并备份现有整个数据卷；替换数据库及匹配密钥。旧 WAL/SHM 文件处理前必须确认数据库已关闭。**不要用 `down -v` 更新，它会删除数据卷。**

更新：先备份，然后 `git pull`、`docker-compose up -d --build`。当前新数据库与上游旧数据库不兼容，不要覆盖上游数据卷。

## 开发

当前构建固定 Bun 1.4.4：

```bash
bun install --frozen-lockfile
bun test tests/
bun run typecheck
bun run build
bun audit --production
bun run dev
```

生产仅挂载 `src/seekrss` 新 API；旧专用路由不暴露。架构见 [docs/SEEKRSS-SPEC.md](docs/SEEKRSS-SPEC.md)，实际验证记录见 [docs/VALIDATION.md](docs/VALIDATION.md)。

**外部验收：**真实 Telegram 发送、目标权限和源站允许的持续查询频率需分别验证。镜像构建或健康检查不能代替这些验收。
