import { PickupList } from '@/components/materials/pickup-list'

export const metadata = { title: 'ใบเบิกที่จ่ายแล้ว' }

export default function PickupDonePage() {
  return <PickupList status="issued" />
}
