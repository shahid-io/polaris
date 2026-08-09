/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @polaris/contracts ships compiled CJS from the workspace; let Next transpile it
  // so the same Zod schemas run in server components and the browser alike.
  transpilePackages: ['@polaris/contracts'],
};

export default nextConfig;
