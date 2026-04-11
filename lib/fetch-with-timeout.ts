/**
 * 带超时的 fetch 包装。
 * - 默认 12 秒超时，避免慢网络下永久 pending 导致 loading 永不消失
 * - 如果调用方传了自己的 signal，会尊重它（任一触发即中止）
 * - 超时被触发时与用户主动 abort 一样会拒绝为 AbortError
 */
export function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 12_000,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  const userSignal = init.signal;
  if (userSignal) {
    if (userSignal.aborted) {
      ctrl.abort();
    } else {
      userSignal.addEventListener("abort", () => ctrl.abort(), { once: true });
    }
  }

  return fetch(input, { ...init, signal: ctrl.signal }).finally(() => {
    clearTimeout(timer);
  });
}
