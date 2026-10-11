import type { NextConfig } from "next";
const nextConfig: NextConfig = { outputFileTracingIncludes: { '/api/*': ['./migrations/*.sql'] } };
export default nextConfig;
