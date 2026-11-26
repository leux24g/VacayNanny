'use client'

import { useId, useLayoutEffect, useRef, useState } from 'react'
import styles from './DestinationField.module.css'

const OTHER = '__other_destination__'

export default function DestinationField({ id, options, value, onValueChange, placeholder = 'Choose a destination', required = false, name }: {
  id: string
  options: string[]
  value: string
  onValueChange: (value: string) => void
  placeholder?: string
  required?: boolean
  name?: string
}) {
  const [otherChosen, setOtherChosen] = useState(false)
  const [draft, setDraft] = useState('')
  const input = useRef<HTMLInputElement>(null), hintId = useId()
  const other = otherChosen || Boolean(value && !options.includes(value))

  useLayoutEffect(() => {
    if (otherChosen) input.current?.focus()
  }, [otherChosen])

  return <div className={styles.field}>
    <select id={id} name={other ? undefined : name} value={other ? OTHER : value} required={required && !other}
      onChange={event => {
        const next = event.target.value
        setOtherChosen(next === OTHER)
        onValueChange(next === OTHER ? draft : next)
      }}>
      <option value="">{placeholder}</option>
      {options.map(option => <option key={option} value={option}>{option}</option>)}
      <option value={OTHER}>Other destination</option>
    </select>
    {other && <div className={styles.custom}>
      <label htmlFor={`${id}-other`}>Your destination</label>
      <input ref={input} id={`${id}-other`} name={name} type="text" autoComplete="off" required
        maxLength={120} pattern={'.*\\S.*'} title="Enter the name of one destination."
        value={value} placeholder="e.g. Tigoni, Kiambu" aria-describedby={hintId}
        onChange={event => {setDraft(event.target.value);onValueChange(event.target.value)}} />
      <p id={hintId}>Enter one location. Our team will confirm whether care is available.</p>
    </div>}
  </div>
}
