/**
 * 带超时的 fetch 包装。
 * - 默认 12 秒超时，避免慢网络下永久 pending 导致 loading 永不消失
 * - 如果调用方传了自己的 signal，会尊重它（任一触发即中止）
 * - 超时被触发时与用户主动 abort 一样会拒绝为 AbortError
 * - 受保护接口的 403（没有 dr_gate）会等待 GateClient 完成 PoW 握手后自动重试一次。
 */

const GATE_READY_EVENT = "dr-gate-ready";
const GATE_DONE_FLAG = "dr_gate_done";
const GATE_WAIT_TIMEOUT_MS = 8000;

function gateAlreadyDone(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return sessionStorage.getItem(GATE_DONE_FLAG) === "1";
  } catch {
    return false;
  }
}

function waitForGateReady(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (gateAlreadyDone()) return Promise.resolve(true);
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      window.removeEventListener(GATE_READY_EVENT, onReady as EventListener);
      resolve(false);
    }, GATE_WAIT_TIMEOUT_MS);
    function onReady() {
      if (done) return;
      done = true;
      clearTimeout(timer);
      window.removeEventListener(GATE_READY_EVENT, onReady as EventListener);
      resolve(true);
    }
    window.addEventListener(GATE_READY_EVENT, onReady as EventListener);
  });
}

async function rawFetch(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number
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

  try {
    return await fetch(input, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

function isProtectedApi(input: RequestInfo | URL): boolean {
  let url = "";
  if (typeof input === "string") url = input;
  else if (input instanceof URL) url = input.toString();
  else if (input && typeof (input as Request).url === "string") url = (input as Request).url;
  return /\/api\/(diaries|moments|profile)/.test(url);
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 12_000
): Promise<Response> {
  // 默认带 cookie，避免组件忘记加 credentials 导致 dr_gate 没发出去
  const initWithCreds: RequestInit = {
    credentials: init.credentials ?? "same-origin",
    ...init,
  };

  const res = await rawFetch(input, initWithCreds, timeoutMs);

  // 受保护接口拿到 403：可能是 GateClient 还没完成握手，等一下再重试一次
  if (res.status === 403 && isProtectedApi(input) && typeof window !== "undefined") {
    const ready = await waitForGateReady();
    if (ready) {
      return rawFetch(input, initWithCreds, timeoutMs);
    }
  }
  return res;
}
