/** Liveness only. Readiness and queue dependencies are checked at /api/health. */
export async function GET(){return Response.json({service:'vacaynanny',status:'alive'},{headers:{'Cache-Control':'no-store'}})}
