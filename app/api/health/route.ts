import {operationalHealth} from '@/lib/operations-health'
export const dynamic='force-dynamic'
export async function GET() {
  const result=await operationalHealth()
  return Response.json(
    { service: 'vacaynanny', status: result.ok?'ok':'degraded',checks:result.checks },
    { status:result.ok?200:503,headers: { 'Cache-Control': 'no-store' } },
  )
}
