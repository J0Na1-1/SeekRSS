import type {FC} from 'hono/jsx';

export const ResetPage:FC=()=> <html lang="zh-CN"><head>
 <meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
 <meta name="color-scheme" content="light dark"/><title>SeekRSS · 重设管理员密码</title>
 <link rel="icon" href="/favicon.svg"/>
 {['style','theme','buttons','form-enhance','home','toast','seekrss'].map(name=><link rel="stylesheet" href={`/css/${name}.css`}/>)}
 <script src="/js/reset.js" defer></script>
 </head><body><section class="auth-panel">
 <div class="auth-brand"><span>🔐</span><h1>SeekRSS</h1><p>重设管理员密码</p></div>
 <form id="resetForm" class="form-card form-stack" hidden>
  <h2>设置新密码</h2><p>管理员账号：<strong id="resetUsername"></strong></p>
  <label class="form-group"><span class="form-label">新密码（12–128 位）</span><input class="input-field" name="password" type="password" autocomplete="new-password" required minlength={12} maxlength={128}/></label>
  <label class="form-group"><span class="form-label">确认新密码</span><input class="input-field" name="confirm_password" type="password" autocomplete="new-password" required minlength={12} maxlength={128}/></label>
  <button class="btn btn-primary btn-block" type="submit">设置新密码</button>
  <p class="muted">成功后旧密码、所有现有登录会话及此链接都会失效。订阅、规则和机器人配置不变。</p>
 </form>
 <p id="resetStatus" role="status" aria-live="polite">正在验证一次性链接…</p>
 <a id="resetLogin" class="btn btn-secondary" href="/" hidden>返回登录</a>
 </section></body></html>;
