'use client'

import FormError from './FormError'

import {clientFetch} from '@/lib/client-request'

import { useMemo, useState } from 'react'
import NannyPhotoEditor from './NannyPhotoEditor'
import {eligibleWorkTiers} from '@/lib/safeguarding'
import { useRouter } from 'next/navigation'
import { DAYS_OF_WEEK, formatKes, tierLabel } from '@/lib/constants'
import { useSiteCatalog } from '@/components/SiteCatalogProvider'
import { tierLabels } from '@/lib/catalog'
import { mergeDestinationChoices } from '@/lib/destinations'
import type { Nanny } from '@/lib/types'


function Chip({
  label,
  checked,
  onToggle,
}: {
  label: string
  checked: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      className={`check-item${checked ? ' checked' : ''}`}
      aria-pressed={checked}
      onClick={onToggle}
    >
      <span className={`check-box${checked ? ' checked' : ''}`}>{checked ? '✓' : ''}</span>
      <span className="check-label">{label}</span>
    </button>
  )
}

export default function NannyProfileEditor({
  nanny,
  destinationCatalog,
}: {
  nanny: Nanny
  destinationCatalog: string[]
}) {
  const router = useRouter()
  const labels = tierLabels(useSiteCatalog().tiers)
  const destinationChoices = useMemo(
    () => mergeDestinationChoices(destinationCatalog, nanny.destinations),
    [destinationCatalog, nanny.destinations],
  )
  const [bio, setBio] = useState(nanny.bio || '')
  const [isActive, setIsActive] = useState(nanny.is_active)
  const [days, setDays] = useState<string[]>(nanny.available_days || [])
  const [destinations, setDestinations] = useState<string[]>(nanny.destinations || [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  function toggle(list: string[], value: string, setList: (next: string[]) => void) {
    setList(list.includes(value) ? list.filter(item => item !== value) : [...list, value])
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    setSaved(false)
    try {
      const body = new FormData()
      body.set('bio', bio)
      body.set('isActive', isActive ? 'true' : 'false')
      body.set('availableDays', JSON.stringify(days))
      body.set('destinations', JSON.stringify(destinations))
      const res = await clientFetch('/api/nanny/profile', { method: 'PATCH', body })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error || 'Could not save your profile.')
        return
      }
      setSaved(true)
      router.refresh()
    } catch {
      setError('Could not connect. Your changes are still on this page; please retry.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
    <NannyPhotoEditor initialUrl={nanny.photo_url} name={nanny.display_name} endpoint="/api/nanny/photo"/>
    <form className="form-card" onSubmit={submit}>
      <h3>Public profile</h3>
      <div className="review-row"><span className="review-key">Name</span><span className="review-val">{nanny.display_name}</span></div>
      <div className="review-row"><span className="review-key">Tier</span><span className="review-val">{tierLabel(nanny.tier, labels)}</span></div>
      <div className="review-row"><span className="review-key">Daily rate</span><span className="review-val">{formatKes(nanny.daily_rate_kes)}</span></div>
      <p>Eligible work: {eligibleWorkTiers(nanny).join(', ')}. Higher qualifications include lower categories; Gold work requires completed safeguarding.</p>
      <p className="field-hint" style={{ margin: '12px 0 16px' }}>
        Tier and rate are set by VacayNanny. You can update your photo, bio, days, destinations, and whether families can find you.
      </p>

      <div className="field" style={{ marginBottom: 16 }}>
        <label htmlFor="nanny-bio">Bio</label>
        <textarea
          id="nanny-bio"
          maxLength={2000}
          value={bio}
          onChange={e => setBio(e.target.value)}
          placeholder="Families read this on your public profile."
        />
      </div>

      <div style={{ marginBottom: 16 }}>
        <p className="field-label-inline">Available days</p>
        <div className="check-grid">
          {DAYS_OF_WEEK.map(day => (
            <Chip key={day} label={day} checked={days.includes(day)} onToggle={() => toggle(days, day, setDays)} />
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <p className="field-label-inline">Destinations</p>
        <div className="check-grid">
          {destinationChoices.map(dest => (
            <Chip
              key={dest}
              label={dest}
              checked={destinations.includes(dest)}
              onToggle={() => toggle(destinations, dest, setDestinations)}
            />
          ))}
        </div>
      </div>

      <label className={`consent-item${isActive ? ' checked' : ''}`}>
        <input
          type="checkbox"
          checked={isActive}
          onChange={e => setIsActive(e.target.checked)}
          style={{ display: 'none' }}
        />
        <span className={`consent-box${isActive ? ' checked' : ''}`}>{isActive ? '✓' : ''}</span>
        <span className="consent-text">
          {isActive
            ? 'Your profile is live. Families can find and book you.'
            : 'Your profile is hidden from the public list. Assigned bookings stay in your dashboard.'}
        </span>
      </label>

      <FormError message={error}/>
      {saved && <p role="status" className="field-hint" style={{ color: '#5ec9b6' }}>Saved. {isActive ? 'You are live.' : 'You are hidden from search.'}</p>}
      <button className="btn-coral" type="submit" disabled={busy} style={{ marginTop: 12 }}>
        {busy ? 'Saving…' : 'Save profile'}
      </button>
    </form>
    </>
  )
}
