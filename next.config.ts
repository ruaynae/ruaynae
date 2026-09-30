import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Next 16 บล็อก chunk ที่มาจาก origin อื่นตอน dev — ถ้าไม่ประกาศไว้
  // หน้าเว็บจะโหลดขึ้นแต่ hydrate ไม่สำเร็จ ปุ่มทุกปุ่มจะกดไม่ติดโดยไม่มี error
  // ให้เห็นในคอนโซล (nextjs-gotchas §1)
  allowedDevOrigins: ['localhost', '127.0.0.1', '*.localhost'],

  // ฟอนต์ที่บอท LINE ใช้วาดรูป (src/lib/line/render.ts) อ่านจากดิสก์ตอนรัน
  // ตัวไล่ไฟล์ของ Next มองไม่เห็น path ที่ประกอบจาก process.cwd() → ต้องบอกเอง
  outputFileTracingIncludes: {
    '/api/line/webhook': ['./public/fonts/**/*'],
    '/api/settings/line/rich-menu': ['./public/fonts/**/*'],
  },

  async headers() {
    return [
      {
        // service worker ต้องไม่ถูกแคช ไม่งั้นผู้ใช้จะค้างอยู่กับ SW ตัวเก่าตลอดไป
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ]
  },
}

export default nextConfig
