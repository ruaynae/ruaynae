import 'server-only'

import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { getAll } from './client'

/**
 * ดึงรายการสินค้า + คงเหลือของร้านที่เลือกจาก Loyverse แล้วเขียนลง `pos_items` (R18 · M0)
 *
 * 🔴 หนึ่งแถว = หนึ่ง variant (บิลของ Loyverse อ้าง `variant_id`)
 * 🔴 ส่งรายการ**ครบทุกหน้า**ให้ `pos_items_sync` ครั้งเดียว — มันปิดแถวที่ไม่อยู่ในรายการ
 *    ถ้าส่งไปครึ่งเดียว สินค้าครึ่งที่เหลือจะถูกปิดใช้งานผิด ๆ
 */

type LvVariantStore = { store_id?: string; price?: number | null; available_for_sale?: boolean; low_stock?: number | null }
type LvVariant = {
  variant_id?: string
  sku?: string | null
  barcode?: string | null
  cost?: number | null
  default_price?: number | null
  option1_value?: string | null
  option2_value?: string | null
  option3_value?: string | null
  stores?: LvVariantStore[]
  deleted_at?: string | null
}
type LvItem = {
  id?: string
  item_name?: string | null
  category_id?: string | null
  track_stock?: boolean
  variants?: LvVariant[]
  deleted_at?: string | null
}
type LvCategory = { id?: string; name?: string | null; deleted_at?: string | null }
type LvLevel = { variant_id?: string; store_id?: string; in_stock?: number | null }

export type PosItemRow = {
  variant_id: string
  item_id: string
  sku: string | null
  name: string
  variant_name: string | null
  category: string | null
  barcode: string | null
  pos_cost: number | null
  price: number | null
  track_stock: boolean
  in_stock: number | null
  pos_low_stock: number | null
}

export type SyncResult = {
  received: number
  inserted: number
  updated: number
  deactivated: number
  active: number
  cost_missing: number
  negative_stock: number
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

/** แปลงข้อมูลดิบของ Loyverse เป็นแถว `pos_items` — แยกเป็นฟังก์ชันล้วนให้ตรวจด้วยข้อมูลตัวอย่างได้ */
export function toRows(items: LvItem[], categories: LvCategory[], levels: LvLevel[], storeId: string): PosItemRow[] {
  const catName = new Map(categories.filter((c) => c.id).map((c) => [c.id!, str(c.name)]))
  const stock = new Map<string, number | null>()
  for (const l of levels) if (l.variant_id && l.store_id === storeId) stock.set(l.variant_id, num(l.in_stock))

  const rows: PosItemRow[] = []
  for (const it of items) {
    if (!it.id || it.deleted_at) continue
    const name = str(it.item_name)
    if (!name) continue
    for (const v of it.variants ?? []) {
      if (!v.variant_id || v.deleted_at) continue
      const st = (v.stores ?? []).find((s) => s.store_id === storeId)
      const variantName = [v.option1_value, v.option2_value, v.option3_value].map(str).filter(Boolean).join(' / ') || null
      const track = it.track_stock === true
      rows.push({
        variant_id: v.variant_id,
        item_id: it.id,
        sku: str(v.sku),
        name,
        variant_name: variantName,
        category: it.category_id ? (catName.get(it.category_id) ?? null) : null,
        barcode: str(v.barcode),
        pos_cost: num(v.cost),
        price: num(st?.price) ?? num(v.default_price),
        track_stock: track,
        in_stock: track ? (stock.get(v.variant_id) ?? null) : null,
        pos_low_stock: num(st?.low_stock),
      })
    }
  }
  return rows
}

export async function syncItems(storeId: string): Promise<SyncResult> {
  const [items, categories, levels] = await Promise.all([
    getAll<LvItem>('/items', 'items'),
    getAll<LvCategory>('/categories', 'categories'),
    getAll<LvLevel>('/inventory', 'inventory_levels', { store_ids: storeId }),
  ])
  const rows = toRows(items, categories, levels, storeId)
  // ไม่ได้อะไรกลับมาเลย = น่าจะผิดปกติ (ร้านผิด/สิทธิ์ไม่พอ) · ห้ามส่งไปปิดสินค้าทั้งร้าน
  if (rows.length === 0) throw new Error('loyverse_no_items')

  const { data, error } = await getSupabaseAdmin().rpc('pos_items_sync', { p_rows: rows as never })
  if (error) throw new Error(error.message)
  return data as unknown as SyncResult
}
