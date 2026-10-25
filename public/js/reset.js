'use strict';
(() => {
  let token = new URLSearchParams(location.hash.slice(1)).get('token') || '';
  history.replaceState(null, '', '/reset');
  const form = document.getElementById('resetForm');
  const status = document.getElementById('resetStatus');
  const login = document.getElementById('resetLogin');
  const button = form.querySelector('button[type=submit]');
  const post = async (path, data) => {
    const response = await fetch('/api/auth/' + path, {
      method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error',
      headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data)
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || '请求失败，请重试');
    return result.data;
  };
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (button.disabled) return;
    const password = form.elements.password.value;
    const confirmation = form.elements.confirm_password.value;
    if (password !== confirmation) { status.textContent = '两次输入的密码不一致'; return; }
    button.disabled = true;
    try {
      await post('reset', {token, password, confirm_password: confirmation});
      token = ''; form.reset(); form.hidden = true; login.hidden = false;
      status.textContent = '密码已更新，旧登录已退出。请返回登录，使用刚设置的新密码。';
    } catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; }
  });
  (async () => {
    try {
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('请从管理员提供的完整一次性链接进入，链接可能已过期或不完整。');
      const data = await post('reset/check', {token});
      document.getElementById('resetUsername').textContent = data.username;
      form.hidden = false;
      status.textContent = '链接有效至 ' + new Date(data.expires_at).toLocaleString() + '。请勿转发此链接；刷新页面后需从原链接重新进入。';
    } catch (error) { token = ''; status.textContent = error.message; login.hidden = false; }
  })();
})();
