'use client'

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import styles from './DatePicker.module.css'

const months = Array.from({length:12}, (_, index) =>
  new Intl.DateTimeFormat('en-GB', {month:'long'}).format(new Date(2024, index, 1)))
const monthNumber = (date: Date) => date.getFullYear() * 12 + date.getMonth()

export default function CalendarNavigation({ month, startMonth, endMonth, onMonthChange, id, children }: {
  month: Date
  startMonth: Date
  endMonth: Date
  onMonthChange: (date: Date) => void
  id: string
  children: ReactNode
}) {
  const [view, setView] = useState<'days'|'months'|'years'>('days')
  const firstYear = startMonth.getFullYear(), lastYear = endMonth.getFullYear(), year = month.getFullYear()
  const yearWindow = (value: number) => Math.max(firstYear, Math.min(lastYear - 11, firstYear + Math.floor((value - firstYear) / 12) * 12))
  const [yearStart, setYearStart] = useState(() => yearWindow(year))
  const panel = useRef<HTMLDivElement>(null), monthButton = useRef<HTMLButtonElement>(null)
  const yearEnd = Math.min(lastYear, yearStart + 11)
  const previousDisabled = view === 'years' ? yearStart <= firstYear
    : view === 'months' ? year <= firstYear : monthNumber(month) <= monthNumber(startMonth)
  const nextDisabled = view === 'years' ? yearEnd >= lastYear
    : view === 'months' ? year >= lastYear : monthNumber(month) >= monthNumber(endMonth)

  useLayoutEffect(() => {
    if (view === 'days') return
    const choices = panel.current
    const target = choices?.querySelector<HTMLButtonElement>('[aria-pressed="true"]:not(:disabled)')
      || choices?.querySelector<HTMLButtonElement>('button[data-calendar-choice]:not(:disabled)')
    target?.focus()
  }, [view, yearStart])

  function changeMonth(next: Date) {
    const bounded = Math.max(monthNumber(startMonth), Math.min(monthNumber(endMonth), monthNumber(next)))
    onMonthChange(new Date(Math.floor(bounded / 12), bounded % 12, 1))
  }
  function move(direction: number) {
    if (view === 'years') setYearStart(current => Math.max(firstYear, Math.min(lastYear - 11, current + direction * 12)))
    else changeMonth(new Date(year + (view === 'months' ? direction : 0), month.getMonth() + (view === 'days' ? direction : 0), 1))
  }
  function back() {
    setView('days')
    requestAnimationFrame(() => monthButton.current?.focus())
  }
  const unit = view === 'years' ? '12 years' : view === 'months' ? 'year' : 'month'

  return <div className={styles.navigation}>
    <div className={styles.toolbar}>
      <div className={styles.captionControls}>
        <button ref={monthButton} type="button" className={styles.captionButton}
          aria-label={`Choose month, ${months[month.getMonth()]}`} aria-expanded={view === 'months'} aria-controls={`${id}-months`}
          onClick={() => view === 'months' ? back() : setView('months')}>
          <span>{months[month.getMonth()]}</span><Chevron />
        </button>
        <button type="button" className={`${styles.captionButton} ${styles.yearButton}`}
          aria-label={`Choose year, ${year}`} aria-expanded={view === 'years'} aria-controls={`${id}-years`}
          onClick={() => {if(view === 'years') back(); else {setYearStart(yearWindow(year));setView('years')}}}>
          <span>{year}</span><Chevron />
        </button>
      </div>
      <div className={styles.pageButtons}>
        <button type="button" aria-label={`Previous ${unit}`} disabled={previousDisabled} onClick={() => move(-1)}><Chevron direction="left" /></button>
        <button type="button" aria-label={`Next ${unit}`} disabled={nextDisabled} onClick={() => move(1)}><Chevron direction="right" /></button>
      </div>
    </div>
    <div hidden={view !== 'days'}>{children}</div>
    {view !== 'days' && <div ref={panel} className={styles.choicePanel} id={`${id}-${view}`} data-year-start={view === 'years' ? yearStart : undefined}>
      <div className={styles.choiceHeading}>
        <h3 id={`${id}-choices-title`}>{view === 'months' ? `Months in ${year}` : 'Choose a year'}</h3>
        {view === 'years' && <span aria-live="polite">{yearStart} to {yearEnd}</span>}
      </div>
      <div role="group" aria-labelledby={`${id}-choices-title`} className={`${styles.choiceGrid} ${view === 'years' ? styles.yearGrid : ''}`}
        onKeyDown={event => {
          const offset = {ArrowLeft:-1,ArrowRight:1,ArrowUp:view === 'years' ? -4 : -3,ArrowDown:view === 'years' ? 4 : 3}[event.key]
          if (offset === undefined && event.key !== 'Home' && event.key !== 'End') return
          const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button'))
          const index = buttons.indexOf(event.target as HTMLButtonElement)
          if (index < 0) return
          event.preventDefault()
          if (event.key === 'Home' || event.key === 'End') {
            const enabled = buttons.filter(button => !button.disabled)
            ;(event.key === 'Home' ? enabled[0] : enabled.at(-1))?.focus()
          } else {
            for (let target = index + offset!; target >= 0 && target < buttons.length; target += offset!) {
              if (!buttons[target].disabled) {buttons[target].focus();break}
            }
          }
        }}>
        {view === 'months' ? months.map((name, index) => {
          const value = year * 12 + index
          return <button type="button" key={name} data-calendar-choice aria-pressed={index === month.getMonth()}
            disabled={value < monthNumber(startMonth) || value > monthNumber(endMonth)}
            onClick={() => {changeMonth(new Date(year,index,1));back()}}>{name}</button>
        }) : Array.from({length:yearEnd - yearStart + 1}, (_, index) => yearStart + index).map(value =>
          <button type="button" key={value} data-calendar-choice aria-pressed={value === year}
            onClick={() => {changeMonth(new Date(value,month.getMonth(),1));setView('months')}}>{value}</button>)}
      </div>
      <button type="button" className={styles.backButton} onClick={back}>Back to calendar</button>
    </div>}
  </div>
}

function Chevron({direction = 'down'}: {direction?: 'down'|'left'|'right'}) {
  const path = direction === 'left' ? 'm14 7-5 5 5 5' : direction === 'right' ? 'm10 7 5 5-5 5' : 'm7 10 5 5 5-5'
  return <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={path}/></svg>
}
