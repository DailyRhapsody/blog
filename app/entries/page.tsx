import { getProfile } from "@/lib/profile-store";
import EntriesPageClient from "./EntriesPageClient";

/**
 * Server component: 预取 profile 后再把结果作为 initialProfile 下传给客户端组件，
 * 避免首帧 profile===null 时 StickyProfileHeader 走居中兜底 → 数据到达后跳到左对齐。
 */
export default async function EntriesPage() {
  let initialProfile = null;
  try {
    initialProfile = await getProfile();
  } catch {
    initialProfile = null;
  }
  return <EntriesPageClient initialProfile={initialProfile} />;
}
