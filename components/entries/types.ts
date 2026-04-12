export type Diary = {
  id: string;
  date: string;
  publishedAt?: string;
  isPublic?: boolean;
  summary: string;
  location?: string;
  tags?: string[];
  images?: string[];
};

export type Comment = {
  id: string;
  author: string;
  content: string;
  createdAt: string;
};

export type PublicMedia = {
  url: string;
  thumbUrl: string;
  mediaType: string;
  width: number;
  height: number;
  duration: number;
  sortOrder: number;
};

export type PublicMoment = {
  id: number;
  type: 1 | 2;
  createdAt: string;
  media: PublicMedia[];
};

export type MomentsTimelineRow = {
  rowKey: string;
  createdAt: string;
  moment: PublicMoment;
};
