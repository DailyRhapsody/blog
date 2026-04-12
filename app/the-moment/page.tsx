import { redirect } from "next/navigation";

/** 老路径已合并到 /entries 的动态 tab */
export default function TheMomentPage() {
  redirect("/entries?tab=moments");
}
