import type { FC } from 'hono/jsx';

const Field: FC<{label:string;children:any}> = ({label,children}) => <label class="form-group"><span class="form-label">{label}</span>{children}</label>;
const Save: FC = () => <div class="form-actions"><button type="submit" class="btn btn-primary">保存</button><button type="button" class="btn btn-secondary" data-reset>取消编辑</button></div>;
export const SeekRSSPage: FC = () => <html lang="zh-CN"><head>
  <meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
  <meta name="color-scheme" content="light dark"/><title>SeekRSS · 论坛监控</title>
  <link rel="icon" href="/favicon.svg"/>
  {['style','theme','buttons','form-enhance','home','toast','seekrss'].map(name=><link rel="stylesheet" href={`/css/${name}.css`}/>)}
  <script src="/js/seekrss.js" defer></script>
</head><body>
  <div id="toast" role="status" aria-live="polite" hidden></div>
  <section id="authPanel" class="auth-panel">
    <div class="auth-brand"><span>📡</span><h1>SeekRSS</h1><p>发现新帖，即刻知悉。</p></div>
    <form id="authForm" class="form-card form-stack">
      <h2 id="authTitle">正在检查登录状态…</h2>
      <Field label="管理员名称"><input class="input-field" name="username" autocomplete="username" required maxlength={64}/></Field>
      <Field label="密码"><input class="input-field" name="password" type="password" autocomplete="current-password" required minlength={12} maxlength={128}/></Field>

      <button class="btn btn-primary btn-block" type="submit">继续</button><p id="authError" role="alert" class="error-text"></p>
    </form><p class="muted">单管理员 · 密码由服务器本地配置 · Web 与 Telegram 共用业务配置</p>
  </section>
  <main id="appPanel" class="home-container" hidden>
    <header class="home-header"><a class="header-logo" href="/"><span class="logo-icon">📡</span><span>SeekRSS</span></a>
      <div class="header-actions"><span id="runBadge" class="status-chip">连接中</span><button class="icon-btn" id="themeBtn" title="切换明暗主题" aria-label="切换明暗主题">◐</button><button class="btn btn-secondary" id="settingsBtn">管理</button><button class="icon-btn" id="logoutBtn" title="退出登录" aria-label="退出登录">↪</button></div>
    </header>
    <div class="content-wrapper">
      <section class="intro"><div><h1>监控信息流</h1><p>只留下你关心的内容。</p></div><button class="btn btn-primary" data-open="sources">＋ RSS 源</button></section>
      <div id="noticeBanner" class="notice" hidden></div>
      <form id="searchForm" class="search-area"><div class="search-box"><span class="search-icon" aria-hidden="true">⌕</span><input id="searchInput" class="search-input" placeholder="搜索标题、摘要…" aria-label="搜索内容"/><button class="btn btn-secondary" type="submit">搜索</button></div></form>
      <div class="toolbar"><div class="toolbar-left"><select id="sourceFilter" class="filter-select" aria-label="筛选 RSS 源"><option value="">全部来源</option></select><button id="matchedBtn" class="toggle-chip" aria-pressed="false">只看命中</button></div><div class="toolbar-right"><button id="refreshBtn" class="btn btn-secondary">刷新</button></div></div>
      <button id="newEntriesBtn" class="new-entries" hidden>有新内容，点击更新</button>
      <section id="postsList" class="posts-list" aria-live="polite"><p class="muted">正在读取本地内容…</p></section>
      <div class="pagination-wrapper"><div class="pagination-controls"><button class="btn btn-secondary" id="prevBtn">上一页</button><span id="pageInfo" class="muted"></span><button class="btn btn-secondary" id="nextBtn">下一页</button></div></div>
      <footer class="page-footer">SeekRSS · 基于 <a href="https://github.com/ljnchn/NodeSeeker-docker" target="_blank" rel="noopener noreferrer">NodeSeeker</a> 二次开发 · MIT</footer>
    </div>
  </main>
  <div id="drawerOverlay" class="drawer-overlay" hidden></div>
  <aside id="managementDrawer" class="drawer drawer-large" role="dialog" aria-modal="true" aria-labelledby="drawerTitle" hidden>
    <div class="drawer-header"><h2 id="drawerTitle" class="drawer-title">管理控制台</h2><button id="closeDrawer" class="drawer-close" aria-label="关闭管理面板">×</button></div>
    <nav class="management-tabs" aria-label="管理分类">{[['sources','RSS 源'],['rules','规则'],['targets','推送目标'],['telegram','机器人'],['template','样式'],['status','运行状态']].map(([id,title])=><button data-tab={id} class="tab-btn">{title}</button>)}</nav>
    <div class="drawer-content">
      <section data-panel="sources">
        <h3>RSS 源</h3><p class="muted">同一源统一采集。测试连接也受网站预算和冷却限制。</p><div id="sourcesList" class="config-list"></div>
        <form id="sourceForm" class="form-card form-stack"><h4>添加 / 编辑源</h4><input name="id" type="hidden"/><input name="revision" type="hidden"/>
          <Field label="名称"><input name="name" class="input-field" required maxlength={100}/></Field><Field label="RSS / Atom 地址"><input name="url" type="url" class="input-field" required placeholder="https://rss.nodeseek.com/"/></Field>
          <Field label="目标检查间隔（秒）"><input name="interval_seconds" type="number" class="input-field" min="1" max="86400" value="10" required/></Field>
          <label class="check-row"><input name="enabled" type="checkbox" checked/>启用采集</label><label class="check-row"><input name="backfill" type="checkbox"/>首次采集补发现有内容（默认不刷历史）</label><Save/>
        </form>
      </section>
      <section data-panel="rules" hidden><h3>关键词与屏蔽规则</h3><p class="muted">独立规则之间为“或”；组合内部为“且”。屏蔽优先，未设置包含规则时不推送。</p><div id="rulesList" class="config-list"></div>
        <form id="ruleForm" class="form-card form-stack"><h4>添加 / 编辑规则</h4><input name="id" type="hidden"/><input name="revision" type="hidden"/>
          <Field label="规则名称（可选）"><input name="name" class="input-field" maxlength={100}/></Field>
          <Field label="规则类型"><select name="kind" class="input-field"><option value="keyword">关键词 · 任一独立词</option><option value="combo">组合关键词 · 全部命中</option><option value="block">屏蔽词 · 任一独立词</option><option value="blockcombo">组合屏蔽词 · 全部命中</option></select></Field>
          <Field label="词语（逗号分隔）"><input name="terms" class="input-field" required placeholder="香港,VPS" maxlength={1000}/><small>普通关键词 / 屏蔽词填写多个时，将建立独立规则。</small></Field>
          <Field label="匹配范围"><select name="scope" class="input-field"><option value="all">标题、RSS 摘要、作者与分类</option><option value="title">仅标题</option><option value="summary">仅 RSS 摘要</option></select></Field>
          <Field label="关联源"><select name="feed_id" class="input-field source-options"><option value="">全部来源</option></select></Field><label class="check-row"><input name="enabled" type="checkbox" checked/>启用规则</label><Save/>
        </form>
        <form id="ruleTestForm" class="form-card form-stack"><h4>本地规则测试</h4><Field label="测试内容"><textarea name="text" class="input-field" rows={3} required/></Field><Field label="关联源"><select name="feed_id" class="input-field source-options"><option value="">全部来源</option></select></Field><button class="btn btn-secondary" type="submit">测试匹配</button><pre id="ruleTestResult" class="result-box"/></form>
      </section>
      <section data-panel="targets" hidden><h3>推送目标</h3><p class="muted">私聊需先向机器人发送 /start。群组 / 频道请确认你有管理权限且 Bot 能发送消息。</p><div id="targetsList" class="config-list"></div>
        <form id="targetForm" class="form-card form-stack"><input name="id" type="hidden"/><input name="revision" type="hidden"/><Field label="目标名称"><input name="name" class="input-field" required maxlength={100}/></Field><Field label="Chat ID"><input name="chat_id" class="input-field" required placeholder="138… 或 -100…"/></Field><Field label="话题 ID（可选）"><input name="topic_id" type="number" min="1" class="input-field"/></Field><label class="check-row"><input name="enabled" type="checkbox" checked/>启用目标</label><Save/></form>
      </section>
      <section data-panel="telegram" hidden><h3>Telegram 机器人</h3><p class="muted">Web 与 /add、/combo、/block 等命令修改同一套配置，仅允许你的 Telegram ID 操作。</p>
        <form id="telegramForm" class="form-card form-stack"><Field label="Bot Token"><input name="bot_token" type="password" class="input-field" autocomplete="new-password" placeholder="留空保留已保存 Token"/><small id="tokenStatus">尚未配置</small></Field><Field label="管理员 Telegram 用户 ID"><input name="admin_telegram_id" class="input-field" inputmode="numeric" placeholder="你的数字用户 ID"/></Field><button class="btn btn-primary" type="submit">保存机器人配置</button></form>
        <form id="runtimeForm" class="form-card form-stack"><h4>采集与推送</h4><Field label="同网站最短请求间隔（秒）"><input name="host_min_interval_seconds" type="number" class="input-field" value="10" min="1" max="86400" required/><small>默认 10 秒；设为 1 秒前需确认源站允许。实时 RSS 不代表无限请求额度。</small></Field><label class="check-row"><input name="paused" type="checkbox"/>暂停推送（继续采集，不补发暂停期间的帖子）</label><button class="btn btn-primary" type="submit">保存运行设置</button></form>
        <button id="testTelegramBtn" class="btn btn-secondary">发送测试消息</button><p id="telegramResult" class="muted"/>
      </section>
      <section data-panel="template" hidden><h3>推送样式</h3><p class="muted">标题 → 命中规则 → 简述 → 发布时间 → 原文链接。发布时间统一为 UTC+8，不显示来源横幅或作者。</p><form id="templateForm" class="form-card form-stack"><Field label="消息模板"><select name="template" class="input-field"><option value="summary">标准版 · 含简述</option><option value="compact">精简版 · 不含简述</option></select></Field><Field label="简述长度（0 为不显示）"><input name="summary_length" class="input-field" type="number" min="0" max="1000" value="300"/></Field><label class="check-row"><input name="show_time" type="checkbox" checked/>显示发布时间（UTC+8）</label><label class="check-row"><input name="link_preview" type="checkbox"/>启用链接预览</label><button class="btn btn-primary" type="submit">保存样式</button></form><button id="previewBtn" class="btn btn-secondary">预览已保存样式</button><pre id="messagePreview" class="result-box">配置后可预览消息。示例内容会明确标注。</pre></section>
      <section data-panel="status" hidden><h3>运行状态</h3><p class="muted">“发送成功”表示 Telegram API 已接受，不代表手机通知已显示。</p><button id="statusRefreshBtn" class="btn btn-secondary">刷新状态</button><pre id="statusResult" class="result-box"/><h4>最近投递</h4><div id="deliveriesList" class="config-list"/></section>
    </div>
  </aside>
</body></html>;
