/** Bounded requests shared by browser forms; callers retain their own draft state. */
export async function clientFetch(input:RequestInfo|URL,init?:RequestInit) {
  const signals=[AbortSignal.timeout(30000),init?.signal,input instanceof Request?input.signal:null].filter((s):s is AbortSignal=>Boolean(s))
  try{return await fetch(input,{...init,signal:AbortSignal.any(signals)})}
  catch(error){
    if(error instanceof Error&&['TimeoutError','AbortError'].includes(error.name))throw new Error('The request timed out. Refresh to check whether it saved before retrying. Your unsaved details are still on this page.')
    throw new Error('Could not connect. Your unsaved details are still on this page; please retry.')
  }
}
