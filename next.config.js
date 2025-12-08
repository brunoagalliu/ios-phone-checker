/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Remove the webpack config since we're using Turbopack now
  // The @/ alias works by default with jsconfig.json
}

module.exports = nextConfig