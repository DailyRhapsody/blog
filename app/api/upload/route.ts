import { NextResponse } from "next/server";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { put } from "@vercel/blob";
import { isAdmin } from "@/lib/auth";
import { rejectCrossSiteWrite } from "@/lib/same-origin";

const UPLOAD_DIR = join(process.cwd(), "public", "uploads");
const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "video/mp4",
  "video/webm",
  "video/quicktime",
];

function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
  };
  return map[mime] ?? "bin";
}

const MAX_FILES = 24;
/** 视频单文件上限（动态/封面等） */
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

export async function POST(req: Request) {
  const badOrigin = rejectCrossSiteWrite(req);
  if (badOrigin) return badOrigin;
  const ok = await isAdmin();
  if (!ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form" }, { status: 400 });
  }
  const files = formData.getAll("files");
  if (!files.length) {
    const single = formData.get("file");
    if (single && single instanceof File) files.push(single);
  }
  if (!files.length) {
    return NextResponse.json({ error: "No files" }, { status: 400 });
  }
  if (files.length > MAX_FILES) {
    return NextResponse.json({ error: `单次最多上传 ${MAX_FILES} 个文件` }, { status: 400 });
  }

  const useBlob = !!process.env.BLOB_READ_WRITE_TOKEN;
  const urls: string[] = [];

  if (useBlob) {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!(file instanceof File)) continue;
      if (!ALLOWED_TYPES.includes(file.type)) continue;
      if (file.type.startsWith("video/") && file.size > MAX_VIDEO_BYTES) {
        return NextResponse.json(
          { error: "单个视频不能超过 100MB" },
          { status: 400 }
        );
      }
      const ext = extFromMime(file.type);
      const pathname = `uploads/${Date.now()}-${i}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
      try {
        const blob = await put(pathname, file, {
          access: "public",
          addRandomSuffix: true,
          contentType: file.type,
        });
        urls.push(blob.url);
      } catch (err) {
        console.error("Blob upload failed:", err);
        return NextResponse.json(
          { error: "上传到存储失败，请检查 BLOB_READ_WRITE_TOKEN" },
          { status: 500 }
        );
      }
    }
  } else {
    await mkdir(UPLOAD_DIR, { recursive: true });
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!(file instanceof File)) continue;
      if (!ALLOWED_TYPES.includes(file.type)) continue;
      if (file.type.startsWith("video/") && file.size > MAX_VIDEO_BYTES) {
        return NextResponse.json(
          { error: "单个视频不能超过 100MB" },
          { status: 400 }
        );
      }
      const ext = extFromMime(file.type);
      const name = `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
      const path = join(UPLOAD_DIR, name);
      const buf = Buffer.from(await file.arrayBuffer());
      await writeFile(path, buf);
      urls.push(`/uploads/${name}`);
    }
  }

  return NextResponse.json({ urls });
}
