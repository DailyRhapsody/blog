/** 登录失败时小幅延迟，降低撞库/暴力尝试速度（不影响成功路径）。 */
export function loginFailureDelayMs(): number {
  return 380 + Math.floor(Math.random() * 320);
}

export async function sleepLoginPenalty(): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, loginFailureDelayMs()));
}
