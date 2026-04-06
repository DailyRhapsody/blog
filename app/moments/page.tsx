import { redirect } from "next/navigation";

/** 已与「画廊」合并，保留旧链接跳转 */
export default function MomentsRedirectPage() {
  redirect("/gallery");
}
