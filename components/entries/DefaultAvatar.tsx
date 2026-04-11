"use client";

import { useState } from "react";
import Image from "next/image";

export function DefaultAvatar({
  src,
  className,
}: {
  src: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const sizeClass = className ?? "h-10 w-10";
  if (failed) {
    return (
      <div
        className={`flex shrink-0 items-center justify-center rounded-full bg-zinc-300 text-xs font-medium text-zinc-600 dark:bg-zinc-600 dark:text-zinc-300 ${sizeClass}`}
        aria-hidden
      >
        滕
      </div>
    );
  }
  return (
    <div
      className={`relative shrink-0 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700 ${sizeClass}`}
      aria-hidden
    >
      <Image
        src={src || "/avatar.png"}
        alt=""
        width={40}
        height={40}
        unoptimized
        className="h-full w-full object-cover"
        onError={() => setFailed(true)}
      />
    </div>
  );
}
