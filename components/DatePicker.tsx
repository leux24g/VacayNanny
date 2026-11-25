'use client'

import { useEffect, useId, useLayoutEffect, useRef, useState, type InputHTMLAttributes } from 'react'
import { DayPicker } from '@daypicker/react'
import { enGB } from '@daypicker/react/locale'
import { calendarDate, calendarValue, dateValueAllowed } from '@/lib/date-fields'
import { todayInNairobi } from '@/lib/booking-validation'
import styles from './DatePicker.module.css'

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'defaultValue' | 'onChange' | 'min' | 'max'> & {
  type?: 'date' | 'datetime-local'
  value?: string
  defaultValue?: string
  min?: string
  max?: string
  onValueChange?: (value: string) => void
  calendarLabel: string
  firstYear?: number
}

export default function DatePicker({
  type = 'date', value, defaultValue = '', onValueChange, calendarLabel,
  firstYear = 1900, min, max, id, className = '', disabled, readOnly,
  onClick, onKeyDown, 'aria-describedby': describedBy, ...inputProps
}: Props) {
  const uniqueId = useId(), inputId = id || `date-${uniqueId}`, popupId = `${inputId}-calendar`
  const input = useRef<HTMLInputElement>(null), popup = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null), timeInput = useRef<HTMLInputElement>(null)
  const [ownedValue, setOwnedValue] = useState(defaultValue), [open, setOpen] = useState(false)
  const [month, setMonth] = useState<Date>(), [draftDate, setDraftDate] = useState<Date>()
  const [draftTime, setDraftTime] = useState('09:00')
  const current = value === undefined ? ownedValue : value, selected = calendarDate(current)
  const today = calendarDate(todayInNairobi())!, lower = calendarDate(min), upper = calendarDate(max)
  const startMonth = lower || new Date(firstYear, 0, 1), endMonth = upper || new Date(today.getFullYear() + 20, 11, 31)
  const draftValue = draftDate ? `${calendarValue(draftDate)}T${draftTime}` : ''
  const validDraft = dateValueAllowed(draftValue, min, max)
  const formatDate = (date: Date) => new Intl.DateTimeFormat('en-GB', {day:'numeric',month:'long',year:'numeric'}).format(date)

  function commit(next: string) {
    if (value === undefined) setOwnedValue(next)
    onValueChange?.(next)
  }
  function close(restoreFocus = true) {
    if (popup.current?.hidePopover && popup.current.matches(':popover-open')) popup.current.hidePopover()
    setOpen(false)
    if (restoreFocus) trigger.current?.focus()
  }
  function show() {
    if (disabled || readOnly || !popup.current || open) return
    if (!popup.current.showPopover) {
      try { input.current?.showPicker() } catch { input.current?.focus() }
      return
    }
    const initial = selected || (upper && today > upper ? upper : lower && today < lower ? lower : today)
    setMonth(initial)
    setDraftDate(selected)
    setDraftTime(current.split('T')[1] || '09:00')
    popup.current.showPopover()
    setOpen(true)
  }
  function select(date: Date | undefined) {
    if (!date) return
    if (type === 'datetime-local') {
      setDraftDate(date)
      requestAnimationFrame(() => timeInput.current?.focus())
    } else {
      commit(calendarValue(date))
      close()
    }
  }

  // A top-layer popover escapes scrollable filters, application panels and modals.
  useLayoutEffect(() => {
    if (!open || !popup.current || !input.current) return
    const panel = popup.current, field = input.current
    const position = () => {
      const view = window.visualViewport
      const width = view?.width || innerWidth, height = view?.height || innerHeight
      const leftEdge = view?.offsetLeft || 0, topEdge = view?.offsetTop || 0
      panel.style.width = `${Math.min(344, width - 24)}px`
      panel.style.maxHeight = `${height - 24}px`
      const anchor = field.getBoundingClientRect(), box = panel.getBoundingClientRect()
      const left = Math.max(leftEdge + 12, Math.min(anchor.left, leftEdge + width - box.width - 12))
      const desiredTop = anchor.bottom + box.height + 20 <= topEdge + height
        ? anchor.bottom + 8 : anchor.top - box.height - 8
      const top = Math.max(topEdge + 12, Math.min(desiredTop, topEdge + height - box.height - 12))
      panel.style.left = `${left}px`
      panel.style.top = `${top}px`
    }
    position()
    // Handle Escape before an enclosing modal's document listener, including
    // the brief moment before focus moves from the trigger into the calendar.
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      if (panel.matches(':popover-open')) panel.hidePopover()
      setOpen(false)
      trigger.current?.focus()
    }
    const observer = new ResizeObserver(position)
    observer.observe(panel)
    window.addEventListener('keydown', escape, true)
    window.addEventListener('resize', position)
    document.addEventListener('scroll', position, true)
    window.visualViewport?.addEventListener('resize', position)
    window.visualViewport?.addEventListener('scroll', position)
    return () => {
      observer.disconnect()
      window.removeEventListener('keydown', escape, true)
      window.removeEventListener('resize', position)
      document.removeEventListener('scroll', position, true)
      window.visualViewport?.removeEventListener('resize', position)
      window.visualViewport?.removeEventListener('scroll', position)
    }
  }, [open])

  useEffect(() => {
    const form = input.current?.form
    if (!form || value !== undefined) return
    const reset = () => setOwnedValue(defaultValue)
    form.addEventListener('reset', reset)
    return () => form.removeEventListener('reset', reset)
  }, [defaultValue, value])

  return (
    <div className={styles.field} data-date-picker>
      <input
        {...inputProps} ref={input} id={inputId} type={type} value={current}
        min={min} max={max} disabled={disabled} readOnly={readOnly}
        className={`${styles.input} ${className}`} lang="en-GB"
        aria-describedby={[describedBy, `${inputId}-hint`].filter(Boolean).join(' ')}
        onChange={event => commit(event.target.value)}
        onClick={event => { onClick?.(event); if (!event.defaultPrevented) { event.preventDefault(); show() } }}
        onKeyDown={event => {
          onKeyDown?.(event)
          if (!event.defaultPrevented && ((event.altKey && event.key === 'ArrowDown') || event.key === 'F4')) { event.preventDefault(); show() }
        }}
      />
      <button ref={trigger} type="button" className={styles.trigger} disabled={disabled || readOnly}
        aria-label={`Open calendar for ${calendarLabel}`} aria-haspopup="dialog" aria-controls={popupId} aria-expanded={open}
        onClick={() => open ? close() : show()}>
        <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
          <rect x="3.5" y="5.5" width="17" height="15" rx="3"/><path d="M7.5 3v5m9-5v5M4 11h16m-12 4h2m4 0h2m-8 3h2"/>
        </svg>
      </button>
      <span className={styles.srOnly} id={`${inputId}-hint`}>Type a date or use the calendar button. Alt and Down Arrow opens the calendar.</span>
      <span className={styles.srOnly} aria-live="polite">{selected ? `Selected ${formatDate(selected)}${type === 'datetime-local' ? ` at ${current.split('T')[1]} EAT` : ''}` : ''}</span>
      <div ref={popup} id={popupId} popover="auto" role="dialog" aria-modal="false"
        aria-labelledby={`${popupId}-title`} className={styles.popover}
        onToggle={() => setOpen(popup.current?.matches(':popover-open') || false)}
        onBlur={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget) && event.relatedTarget !== trigger.current && event.relatedTarget !== input.current) close(false) }}
        onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() } }}>
        {open && <>
          <div className={styles.heading}>
            <h2 id={`${popupId}-title`} className={styles.title}>Choose {calendarLabel}</h2>
            <button type="button" className={styles.close} aria-label="Close calendar" onClick={() => close()}>×</button>
          </div>
          <DayPicker className={styles.calendar} mode="single" month={month} onMonthChange={setMonth}
            selected={type === 'datetime-local' ? draftDate : selected} onSelect={select}
            today={today} locale={enGB} captionLayout="dropdown" navLayout="after"
            startMonth={startMonth} endMonth={endMonth} showOutsideDays fixedWeeks autoFocus
            disabled={[...(lower ? [{before:lower}] : []), ...(upper ? [{after:upper}] : [])]}
            footer={(type === 'datetime-local' ? draftDate : selected) ? formatDate((type === 'datetime-local' ? draftDate : selected)!) : 'Choose a day to select your date.'}
          />
          {type === 'datetime-local' && <div className={styles.timeRow}>
            <label htmlFor={`${inputId}-time`}>Time (EAT)</label>
            <input ref={timeInput} id={`${inputId}-time`} type="time" step={inputProps.step || 60} value={draftTime}
              onChange={event => setDraftTime(event.target.value)}
              onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); if (validDraft) { commit(draftValue); close() } } }} />
          </div>}
          <div className={styles.actions}>
            <button type="button" disabled={!current} onClick={() => { commit(''); close() }}>Clear date</button>
            {type === 'datetime-local'
              ? <button type="button" className={styles.apply} disabled={!validDraft} onClick={() => { commit(draftValue); close() }}>Apply date &amp; time</button>
              : dateValueAllowed(calendarValue(today), min, max) && <button type="button" onClick={() => select(today)}>Today</button>}
          </div>
          {type === 'datetime-local' && draftDate && !validDraft && <p className={styles.hint}>Choose a valid time within the allowed range.</p>}
        </>}
      </div>
    </div>
  )
}
