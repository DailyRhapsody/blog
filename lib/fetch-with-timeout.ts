/**
 * 带超时的 fetch 包装。
 * - 默认 30 秒超时（应对 Vercel function 冷启动 + Notion API 缓存 MISS 时的全量拉取，
 *   实测首次冷启动可达 16-18s。原 12s 默认在缓存失效后会 abort 导致空白页）
 * - 重试圈用 8 秒超时（缓存已建好，正常响应 ≤ 3s 足够）
 * - 总耗时上限 = 30s（首攻）+ 8s（waitForGateReady）+ 8s × 3（退避重试）≈ 47s
 *   故障态恢复路径（已有 cache 但首次握手失败）= 8s × 退避 ≈ 16-20s
 * - 如果调用方传了自己的 signal，会尊重它（任一触发即中止）
 * - 受保护接口的 403（没有 dr_gate）会等待 GateClient 完成 PoW 握手后阶梯重试。
 */

const GATE_READY_EVENT = "dr-gate-ready";
const GATE_DONE_FLAG = "dr_gate_done";
const GATE_WAIT_TIMEOUT_MS = 8000;
const RETRY_TIMEOUT_MS = 8000;

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
    function finish(ok: boolean) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearInterval(poll);
      window.removeEventListener(GATE_READY_EVENT, onReady as EventListener);
      resolve(ok);
    }
    function onReady() { finish(true); }
    // 关键：除了监听事件，再开一个轮询兜底。
    // 因为 fetchWithTimeout 第一次拿到 403 后才进入这里 addEventListener，
    // GateClient 可能在我们注册监听器之前就已经 dispatch 完事件并写好
    // sessionStorage 标记 —— 此时事件丢失但 gateAlreadyDone() 能查到。
    const poll = setInterval(() => { if (gateAlreadyDone()) finish(true); }, 100);
    const timer = setTimeout(() => finish(false), GATE_WAIT_TIMEOUT_MS);
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
  timeoutMs = 30_000
): Promise<Response> {
  // 默认带 cookie，避免组件忘记加 credentials 导致 dr_gate 没发出去
  const initWithCreds: RequestInit = {
    credentials: init.credentials ?? "same-origin",
    ...init,
  };

  const res = await rawFetch(input, initWithCreds, timeoutMs);

  // 受保护接口拿到 403：可能是 GateClient 还没完成握手。
  // 退避重试 3 次（间隔 400ms / 1200ms / 2500ms，总耗时 ≤ 12s 与 timeoutMs 对齐），
  // 每次重试前重新检查 sessionStorage 标记，避免单次重试错过握手完成的窗口。
  if (res.status === 403 && isProtectedApi(input) && typeof window !== "undefined") {
    const ready = await waitForGateReady();
    if (ready) {
      const retryDelays = [400, 1200, 2500];
      // 重试圈用 RETRY_TIMEOUT_MS（8s），不再用 timeoutMs（默认 30s）
      // 因为缓存命中后正常响应 ≤ 3s，重试再用 30s 是浪费用户等待。
      let lastRes = await rawFetch(input, initWithCreds, RETRY_TIMEOUT_MS);
      for (let i = 0; i < retryDelays.length; i++) {
        if (lastRes.status !== 403) return lastRes;
        await new Promise((r) => setTimeout(r, retryDelays[i]));
        if (!gateAlreadyDone()) {
          const reReady = await waitForGateReady();
          if (!reReady) return lastRes;
        }
        lastRes = await rawFetch(input, initWithCreds, RETRY_TIMEOUT_MS);
      }
      return lastRes;
    }
  }
  return res;
}
