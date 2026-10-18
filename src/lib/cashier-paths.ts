/**
 * หน้าที่แคชเชียร์ร้านเปิดได้ (R18) — ใช้ใน `(app)/layout.tsx`
 * `/settings` เปิดได้เฉพาะหน้าหลัก (เปลี่ยน PIN · เปิดแจ้งเตือน · ธีม) ไม่รวมหน้าย่อย
 */
export function cashierMayOpen(path: string): boolean {
  return path === '/pickup' || path.startsWith('/pickup/') || path === '/settings'
}
