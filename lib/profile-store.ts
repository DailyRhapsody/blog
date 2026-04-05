import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export type Profile = {
  name: string;
  signature: string;
  avatar: string;
  headerBg: string;
  /** 首页 / 封面背景；空字符串则用内置默认图 */
  homeCoverUrl: string;
  /** true 时 homeCoverUrl 为视频（MP4/WebM 等） */
  homeCoverIsVideo: boolean;
};

const DEFAULT_PROFILE: Profile = {
  name: "DailyRhapsody",
  signature: "君子论迹不论心",
  avatar: "/avatar.png",
  headerBg: "/header-bg.png",
  homeCoverUrl: "",
  homeCoverIsVideo: false,
};

function normalizeProfile(raw: unknown): Profile {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_PROFILE };
  const o = raw as Record<string, unknown>;
  return {
    name: typeof o.name === "string" ? o.name : DEFAULT_PROFILE.name,
    signature: typeof o.signature === "string" ? o.signature : DEFAULT_PROFILE.signature,
    avatar: typeof o.avatar === "string" ? o.avatar : DEFAULT_PROFILE.avatar,
    headerBg: typeof o.headerBg === "string" ? o.headerBg : DEFAULT_PROFILE.headerBg,
    homeCoverUrl:
      typeof o.homeCoverUrl === "string" ? o.homeCoverUrl : DEFAULT_PROFILE.homeCoverUrl,
    homeCoverIsVideo:
      typeof o.homeCoverIsVideo === "boolean"
        ? o.homeCoverIsVideo
        : DEFAULT_PROFILE.homeCoverIsVideo,
  };
}

const DATA_DIR = join(process.cwd(), "data");
const DATA_FILE = join(DATA_DIR, "profile.json");

async function readFromFile(): Promise<unknown | null> {
  try {
    const raw = await readFile(DATA_FILE, "utf8");
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

async function writeToFile(profile: Profile): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(DATA_FILE, JSON.stringify(profile, null, 2), "utf8");
}

export async function getProfile(): Promise<Profile> {
  const p = await readFromFile();
  if (p) return normalizeProfile(p);
  return { ...DEFAULT_PROFILE };
}

export async function saveProfile(updates: Partial<Profile>): Promise<Profile> {
  const current = await getProfile();
  const filtered: Partial<Profile> = {};
  for (const [k, v] of Object.entries(updates)) {
    if (v !== undefined) (filtered as Record<string, unknown>)[k] = v;
  }
  const next: Profile = normalizeProfile({ ...current, ...filtered });
  await writeToFile(next);
  return next;
}
