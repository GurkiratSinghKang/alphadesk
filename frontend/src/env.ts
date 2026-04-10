export const env = {
  API_URL: process.env.NEXT_PUBLIC_API_URL ?? "",
  WS_URL: process.env.NEXT_PUBLIC_WS_URL ?? "",
} as const;
