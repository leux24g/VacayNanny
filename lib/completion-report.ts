export type CompletionReport = {
  hoursWorked:number; summary:string; additionalServices:string; expenses:string; accuracy:boolean
  dateFrom?:string; dateTo?:string; bookingVersion?:number
}
export function completionReportErrors(body: unknown): string[] {
  if(!body || typeof body!=='object')return ['Complete your booking report before requesting a family code.']
  const r=body as CompletionReport, errors:string[]=[]
  if(typeof r.hoursWorked!=='number'||!Number.isFinite(r.hoursWorked)||r.hoursWorked<=0||r.hoursWorked>8784||r.hoursWorked*4!==Math.trunc(r.hoursWorked*4))errors.push('Enter the actual hours worked, in quarter-hour increments.')
  if(typeof r.summary!=='string'||r.summary.trim().length<10||r.summary.length>2000)errors.push('Describe the work and handover in 10–2000 characters.')
  if(typeof r.additionalServices!=='string'||r.additionalServices.length>1000||typeof r.expenses!=='string'||r.expenses.length>1000)errors.push('Keep additional services and expense notes to 1000 characters each.')
  if(r.accuracy!==true)errors.push('Confirm that the completion report is accurate.')
  return errors
}
