import ContactPage from '@/components/ContactPage'

export const metadata = { title: 'Contact VacayNanny' }
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ service?: string }>
}) {
  const { service } = await searchParams
  const allowed = [
    'Specialised Childcare',
    'Adult & Elderly Care',
    'Professional Nursing Care',
  ]
  return (
    <ContactPage
      service={service && allowed.includes(service) ? service : ''}
    />
  )
}
