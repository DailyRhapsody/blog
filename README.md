This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Custom domain & Cloudflare（可选）

当前可使用 Vercel 默认域名（如 `dailyrhapsody.vercel.app`）。后续若绑定自有域名并希望在前端使用 **Cloudflare WAF / 质询** 等边缘防护，参见 **[docs/custom-domain-cloudflare.md](./docs/custom-domain-cloudflare.md)**（含 DNS、SSL、规则草稿与注意事项）。

## Storage (Production)

This project supports two storage modes:

- PostgreSQL when `DATABASE_URL` is configured (recommended for production).
- Local file `data/diaries.json` only as a development fallback.

### Why

Serverless runtimes (for example Vercel) cannot persist writes under app directories such as `/var/task`.
If `DATABASE_URL` is missing in production, write APIs will fail fast with a clear error.

### Setup

1. Provision a PostgreSQL database (Supabase/Neon/RDS/etc.).
2. Set `DATABASE_URL` in your deployment environment and local `.env.local`.
3. (Optional) call `POST /api/seed` while logged in as admin to import `app/diaries.data.ts`.
