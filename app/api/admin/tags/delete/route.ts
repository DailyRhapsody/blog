import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "标签管理已迁移到 Notion，请在 Notion 数据库中直接删除 Tags 属性值。" },
    { status: 410 }
  );
}
