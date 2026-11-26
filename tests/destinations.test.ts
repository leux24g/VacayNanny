import { test } from 'node:test'
import assert from 'node:assert/strict'
import { destinationError } from '../lib/destinations'

test('requests accept one listed or custom destination without publishing new coverage', () => {
  for (const value of ['Nairobi', 'Tigoni, Kiambu', '  Lake Baringo  ', 'São Vicente']) assert.equal(destinationError(value), null)
})
test('requests require a bounded location name rather than the Other marker, multiple values or control characters', () => {
  for (const value of [undefined, null, '', '  ', 'Other', 'any', '__other_destination__', ['Nairobi','Diani'], {}, 'a'.repeat(121), 'Tigoni\nKiambu', 'Tigoni\u2028Kiambu']) assert.ok(destinationError(value), String(value))
})
