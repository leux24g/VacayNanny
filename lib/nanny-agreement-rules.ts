export const NANNY_AGREEMENT_VERSION = '2026-11-24-revised'
export const NANNY_AGREEMENT_SHA256 = '9eb913dbb9d462385a60abf97ddb478dc48f13519aab258ae78d4257ba98fc71'
export const NANNY_AGREEMENT_PDF = '/documents/vacaynanny-nanny-agreement-2026-11-24.pdf'

export type AgreementFields = {
  agreementAccepted: boolean
  agreementVersion: string
  agreementSignerName: string
  payoutMethod: string
  payoutAccountName: string
  payoutAccountNumber: string
  payoutBankName: string
}

export const EMPTY_AGREEMENT: AgreementFields = {
  agreementAccepted: false, agreementVersion: NANNY_AGREEMENT_VERSION,
  agreementSignerName: '', payoutMethod: '', payoutAccountName: '',
  payoutAccountNumber: '', payoutBankName: '',
}

const normalizedName = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en')

export function validateAgreement(body: Record<string, unknown>, legalName: string): string[] {
  const errors: string[] = []
  const text = (key: string) => typeof body[key] === 'string' ? String(body[key]).trim() : ''
  if (body.agreementAccepted !== true) errors.push('Read the nanny agreement and tick that you have read, understood and accepted it.')
  if (body.agreementVersion !== NANNY_AGREEMENT_VERSION) errors.push('Review the current nanny agreement before continuing.')
  if (text('agreementSignerName').length < 2 || text('agreementSignerName').length > 120 || normalizedName(text('agreementSignerName')) !== normalizedName(legalName))
    errors.push('Enter your full legal name exactly as shown in your application to accept the agreement.')
  if (!['mpesa', 'bank'].includes(text('payoutMethod'))) errors.push('Choose M-Pesa or a bank account for payouts.')
  if (text('payoutAccountName').length < 2 || text('payoutAccountName').length > 120) errors.push('Enter the payout account holder’s name.')
  const number = text('payoutAccountNumber').replace(/[\s-]/g, '')
  if (text('payoutMethod') === 'mpesa' ? !/^(?:\+?254|0)?[17]\d{8}$/.test(number) : !/^[a-zA-Z0-9]{5,34}$/.test(number))
    errors.push(text('payoutMethod') === 'mpesa' ? 'Enter a valid Kenyan M-Pesa number.' : 'Enter a valid bank account number (5–34 letters or digits).')
  if (text('payoutMethod') === 'bank' && (text('payoutBankName').length < 2 || text('payoutBankName').length > 100)) errors.push('Enter the bank name.')
  return errors
}

export const TIER_COMMISSION = {
  bronze: { commission: '22.73%', payout: '77.27%' },
  silver: { commission: '21.88%', payout: '78.12%' },
  gold: { commission: '21.15%', payout: '78.85%' },
} as const
