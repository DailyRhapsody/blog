"use client";

import { useEffect, type Dispatch, type SetStateAction } from "react";

/** 一旦累计到这个 deltaX 就立刻切 tab —— 不再等 wheel 停下 */
const WHEEL_TRIGGER_DELTA = 40;
/** 切 tab 后，必须 wheel 静默这么久才允许下一次切，防止 trackpad 惯性把第二次切也带出去 */
const WHEEL_IDLE_RESET_MS = 220;
const TOUCH_AXIS_LOCK_DELTA = 10;
const TOUCH_TRIGGER_DELTA = 50;

/**
 * 让任意位置的横向滚轮（trackpad / 鼠标横滚）和触屏左右滑动都能切顶部 tab。
 *
 * 顺手做两件事：
 * 1. 屏蔽浏览器自带的左右滑动导航（Safari/Chrome 在 macOS 上的「← / →」回退/前进），
 *    通过 `overscroll-behavior-x: none` + 在判定为水平滑动的 touchmove 上 preventDefault。
 * 2. 触屏 touchmove 一旦判定为水平滑动就吃掉竖向滚动，避免边滑边滚出现的「滑歪」体验。
 *
 * 之前这一坨在 entries/page.tsx 里有 60+ 行，跟其他 6 个 useEffect 缠在一起，抽出来后
 * page 那一侧只剩一行 hook 调用。
 */
export function useTabSwipeNavigation(
  setTab: Dispatch<SetStateAction<number>>,
  { min = 0, max = 1 }: { min?: number; max?: number } = {},
) {
  useEffect(() => {
    let wheelAccum = 0;
    /** 已经触发过 setTab、正在等 wheel 停下来才允许下一次的「冷却」状态 */
    let cooldown = false;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;

    function onWheel(e: WheelEvent) {
      // 只关心横向意图：deltaX 的绝对值要大于 deltaY 才算横滚
      if (!(Math.abs(e.deltaX) > Math.abs(e.deltaY) && Math.abs(e.deltaX) > 2)) return;
      e.preventDefault();

      // 不管在不在冷却，每来一个事件都把「静默判定」往后推
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        cooldown = false;
        wheelAccum = 0;
      }, WHEEL_IDLE_RESET_MS);

      // 冷却期内不再累加：trackpad 惯性还在继续 emit deltaX，
      // 之前的纯防抖写法等惯性结束才 fire，肉眼就是切 tab 慢半拍
      if (cooldown) return;

      wheelAccum += e.deltaX;
      if (Math.abs(wheelAccum) >= WHEEL_TRIGGER_DELTA) {
        const direction = wheelAccum > 0 ? 1 : -1;
        setTab((prev) =>
          direction > 0 ? Math.min(prev + 1, max) : Math.max(prev - 1, min),
        );
        cooldown = true;
        wheelAccum = 0;
      }
    }

    /* 全局 touch：页面任意位置左右滑动切 tab */
    let startX = 0;
    let startY = 0;
    let isHz: boolean | null = null;

    function onTouchStart(e: TouchEvent) {
      startX = e.touches[0]?.clientX ?? 0;
      startY = e.touches[0]?.clientY ?? 0;
      isHz = null;
    }
    function onTouchMove(e: TouchEvent) {
      if (isHz === false) return;
      const dx = (e.touches[0]?.clientX ?? startX) - startX;
      const dy = (e.touches[0]?.clientY ?? startY) - startY;
      if (
        isHz === null &&
        (Math.abs(dx) > TOUCH_AXIS_LOCK_DELTA || Math.abs(dy) > TOUCH_AXIS_LOCK_DELTA)
      ) {
        isHz = Math.abs(dx) > Math.abs(dy);
      }
      if (isHz) e.preventDefault();
    }
    function onTouchEnd(e: TouchEvent) {
      if (!isHz) return;
      const dx = (e.changedTouches[0]?.clientX ?? startX) - startX;
      if (Math.abs(dx) > TOUCH_TRIGGER_DELTA) {
        setTab((prev) =>
          dx < 0 ? Math.min(prev + 1, max) : Math.max(prev - 1, min),
        );
      }
    }

    document.addEventListener("wheel", onWheel, { passive: false });
    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onTouchEnd);
    document.documentElement.style.overscrollBehaviorX = "none";

    return () => {
      document.removeEventListener("wheel", onWheel);
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      document.documentElement.style.overscrollBehaviorX = "";
      if (idleTimer) clearTimeout(idleTimer);
    };
  }, [setTab, min, max]);
}
