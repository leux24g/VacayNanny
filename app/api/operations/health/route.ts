import {NextRequest,NextResponse} from 'next/server'
import {authorizedCron} from '@/lib/cron-auth'
import {operationalHealth} from '@/lib/operations-health'
export async function GET(request:NextRequest){
 if(!authorizedCron(request.headers.get('authorization'),process.env.MONITOR_SECRET))return NextResponse.json({error:'Unauthorized'},{status:401})
 const result=await operationalHealth()
 return NextResponse.json(result,{status:result.ok?200:503,headers:{'Cache-Control':'private, no-store'}})
}
