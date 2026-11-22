/** @type {import('next').NextConfig} */
const nextConfig = {
  output: process.env.GITHUB_PAGES === 'true' ? 'export' : undefined,
  basePath: process.env.GITHUB_PAGES === 'true' ? (process.env.NEXT_PUBLIC_BASE_PATH || '/matplanpluss') : '',
  assetPrefix: process.env.GITHUB_PAGES === 'true' ? (process.env.NEXT_PUBLIC_BASE_PATH || '/matplanpluss') : '',
  reactStrictMode: true,
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
};

export default nextConfig;
