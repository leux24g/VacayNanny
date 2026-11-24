'use client'
import { useState } from 'react'
import FamilyBookings from './FamilyBookings'
import type { Booking } from '@/lib/types'
import styles from './Portal.module.css'

export default function ClientBookings({ bookings }: { bookings: Booking[] }) {
  const [filter, setFilter] = useState('all'), [query, setQuery] = useState('')
  const shown = bookings.filter(booking => (filter === 'all' || (filter === 'active' ? !['completed','cancelled'].includes(booking.status) : ['completed','cancelled'].includes(booking.status))) && `${booking.destination} ${booking.nannies?.display_name || ''} ${booking.id}`.toLowerCase().includes(query.trim().toLowerCase()))
  return <>
    {bookings.length > 0 && <div className={styles.filters}><label className="sr-only" htmlFor="client-booking-search">Find a booking</label><input id="client-booking-search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search destination, nanny or booking ID" />{[['all','All trips'],['active','Current & upcoming'],['history','Completed & cancelled']].map(([id,label]) => <button type="button" aria-pressed={filter === id} key={id} onClick={() => setFilter(id)}>{label}</button>)}</div>}
    {bookings.length > 0 && !shown.length ? <p role="status">No bookings match these filters. Try another search or choose All trips.</p> : <FamilyBookings bookings={shown} />}
  </>
}
