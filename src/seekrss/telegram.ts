import type { TelegramTransport } from './types';

/** Fixed-origin Bot API boundary. Never expose URL-bearing fetch errors. */
export const telegramRequest: TelegramTransport = async (token, method, payload, signal) => {
  if (!token || !/^[A-Za-z][A-Za-z0-9]*$/.test(method)) throw new Error('Telegram 配置无效');
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(abort, method === 'getUpdates' ? 35_000 : 15_000);
  try {
    const response = await fetch(`https://api.telegram.org/bot${encodeURI(token)}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      signal: controller.signal, redirect: 'error',
    });
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 1024 * 1024) { await reader.cancel(); throw new Error(); }
        chunks.push(value);
      }
    } finally { reader?.releaseLock(); }
    const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!result || typeof result.ok !== 'boolean') throw new Error();
    return result;
  } catch { throw new Error('Telegram 网络请求失败，请检查网络或凭据'); }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
};
