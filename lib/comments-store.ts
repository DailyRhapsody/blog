import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export type Comment = {
  id: string;
  diaryId: number;
  author: string;
  content: string;
  createdAt: string; // ISO
};

const DATA_DIR = join(process.cwd(), "data");
const DATA_FILE = join(DATA_DIR, "comments.json");

async function readFromFile(): Promise<Comment[]> {
  try {
    const raw = await readFile(DATA_FILE, "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function writeToFile(comments: Comment[]): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(DATA_FILE, JSON.stringify(comments, null, 2), "utf8");
}

export async function getComments(diaryId: number): Promise<Comment[]> {
  const all = await readFromFile();
  return all.filter((c) => c.diaryId === diaryId).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

export async function addComment(comment: Omit<Comment, "id" | "createdAt">): Promise<Comment> {
  const author = String(comment.author ?? "").trim().slice(0, 50);
  const content = String(comment.content ?? "").trim().slice(0, 5000);
  if (!author || !content) {
    throw new Error("Author and content are required");
  }
  const all = await readFromFile();
  const id = String(Date.now() + "-" + Math.random().toString(36).slice(2, 9));
  const createdAt = new Date().toISOString();
  const newComment: Comment = { id, diaryId: comment.diaryId, author, content, createdAt };
  all.push(newComment);
  await writeToFile(all);
  return newComment;
}
