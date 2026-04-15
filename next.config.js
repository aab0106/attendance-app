/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["undici"],
  turbopack: {},
};

module.exports = nextConfig;
