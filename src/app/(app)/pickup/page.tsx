import { PickupList } from '@/components/materials/pickup-list'

export const metadata = { title: 'ใบเบิกรอจ่าย' }

export default function PickupPage() {
  return <PickupList status="open" />
}
