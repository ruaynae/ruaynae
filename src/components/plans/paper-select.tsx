'use client'

/** กระดาษที่ใช้พิมพ์ชีตแผนงานในไฟล์ Excel (แนวนอน ย่อพอดีความกว้าง) */
export type Paper = 'A3' | 'A4'

export function PaperSelect({ value, onChange }: { value: Paper; onChange: (v: Paper) => void }) {
  return (
    <label className="flex shrink-0 items-center gap-2 text-sm text-ink-2">
      กระดาษพิมพ์
      <select className="input-base w-auto py-1.5" value={value} onChange={(e) => onChange(e.target.value === 'A4' ? 'A4' : 'A3')}>
        <option value="A3">A3</option>
        <option value="A4">A4</option>
      </select>
    </label>
  )
}
