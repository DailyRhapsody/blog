import { redirect } from "next/navigation";

/** 老路径已与 /entries 的画廊 tab 合并，保留旧链接跳转 */
export default function MomentsRedirectPage() {
  redirect("/entries?tab=gallery");
}
