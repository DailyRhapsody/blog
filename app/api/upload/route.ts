import { NextResponse } from "next/server";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
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

function getSupabaseUploadConfig() {
  const url = process.env.SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const bucket = process.env.SUPABASE_STORAGE_BUCKET?.trim() || "gallery";
  if (!url || !serviceRoleKey) return null;
  return { url, serviceRoleKey, bucket };
}

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

  const supabaseConfig = getSupabaseUploadConfig();
  const urls: string[] = [];
  const isProd = process.env.NODE_ENV === "production";

  if (!supabaseConfig && isProd) {
    return NextResponse.json(
      { error: "服务器未配置 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY，生产环境无法上传文件" },
      { status: 503 }
    );
  }

  if (supabaseConfig) {
    const supabase = createClient(supabaseConfig.url, supabaseConfig.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!(file instanceof File)) continue;
      if (!ALLOWED_TYPES.includes(file.type)) {
        return NextResponse.json(
          { error: `不支持的文件类型：${file.type || "unknown"}` },
          { status: 400 }
        );
      }
      if (file.type.startsWith("video/") && file.size > MAX_VIDEO_BYTES) {
        return NextResponse.json(
          { error: "单个视频不能超过 100MB" },
          { status: 400 }
        );
      }
      const ext = extFromMime(file.type);
      const pathname = `uploads/${Date.now()}-${i}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
      try {
        const buffer = Buffer.from(await file.arrayBuffer());
        const uploaded = await supabase.storage
          .from(supabaseConfig.bucket)
          .upload(pathname, buffer, {
            contentType: file.type,
            upsert: false,
            cacheControl: "31536000",
          });
        if (uploaded.error) {
          throw uploaded.error;
        }
        const { data } = supabase.storage
          .from(supabaseConfig.bucket)
          .getPublicUrl(uploaded.data.path);
        if (!data.publicUrl) {
          throw new Error("Supabase public url missing");
        }
        urls.push(data.publicUrl);
      } catch (err) {
        console.error("Supabase upload failed:", err);
        return NextResponse.json(
          { error: "上传到 Supabase Storage 失败，请检查 bucket/权限/环境变量" },
          { status: 500 }
        );
      }
    }
  } else {
    try {
      await mkdir(UPLOAD_DIR, { recursive: true });
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!(file instanceof File)) continue;
        if (!ALLOWED_TYPES.includes(file.type)) {
          return NextResponse.json(
            { error: `不支持的文件类型：${file.type || "unknown"}` },
            { status: 400 }
          );
        }
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
    } catch (err) {
      console.error("Local upload failed:", err);
      return NextResponse.json({ error: "上传失败，请检查服务器存储配置" }, { status: 500 });
    }
  }

  return NextResponse.json({ urls });
}
