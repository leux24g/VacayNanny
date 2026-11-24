import { notFound } from 'next/navigation'
import PaymentReturn from '../page'
import { paystackSettings } from '@/lib/paystack-settings'

export { metadata } from '../page'

export default async function EnvironmentPaymentReturn({ params, searchParams }: {
  params: Promise<{ environment: string }>
  searchParams: Promise<{ reference?: string }>
}) {
  const { environment } = await params
  if (environment !== paystackSettings().environment) notFound()
  return <PaymentReturn searchParams={searchParams} />
}
