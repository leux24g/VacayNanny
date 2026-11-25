import { test } from 'node:test'
import assert from 'node:assert/strict'
import { birthDateLimit, calendarDate, calendarValue, dateValueAllowed } from '../lib/date-fields'

test('calendar values round-trip without a UTC conversion, including leap days', () => {
  for (const timezone of ['Africa/Nairobi', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
    const previous = process.env.TZ
    process.env.TZ = timezone
    try {
      for (const value of ['1990-01-01', '2028-02-29', '2027-12-31']) {
        assert.equal(calendarValue(calendarDate(value)!), value, timezone)
      }
    } finally {
      if (previous === undefined) delete process.env.TZ
      else process.env.TZ = previous
    }
  }
  for (const value of ['', '2027-02-29', '2028-02-30', '2027-13-01', '12/03/2027']) {
    assert.equal(calendarDate(value), undefined)
  }
})

test('calendar limits include same-day care and enforce local date and time bounds', () => {
  assert.equal(dateValueAllowed('2027-06-10', '2027-06-10', '2027-06-10'), true)
  assert.equal(dateValueAllowed('2027-06-09', '2027-06-10'), false)
  assert.equal(dateValueAllowed('2027-06-11', undefined, '2027-06-10'), false)
  assert.equal(dateValueAllowed('2027-06-10T09:30', '2027-06-10T09:30:00', '2027-06-10'), true)
  assert.equal(dateValueAllowed('2027-06-10T09:29', '2027-06-10T09:30'), false)
  assert.equal(dateValueAllowed('2027-06-10T24:00'), false)
  assert.equal(dateValueAllowed('2027-06-10T09:70'), false)
  assert.equal(dateValueAllowed('2027-06-10invalid'), false)
})

test('the birth calendar uses the existing minimum age of 21', () => {
  assert.equal(birthDateLimit(new Date('2026-11-26T12:00:00Z')), '2005-11-26')
})
