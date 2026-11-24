'use client'

import { useState } from 'react'
import MediaImage from './MediaImage'
import styles from './ImageSlideshow.module.css'

type Slide = { src: string; position?: string }

/** A still decorative photograph, with a fallback if its source is unavailable. */
export default function ImageSlideshow({ slides, label, sizes, priority = false }: {
  slides: readonly Slide[]; label: string; sizes: string; priority?: boolean
}) {
  const [index, setIndex] = useState(0)
  const slide = slides[index]
  return <div className={styles.root} role="group" aria-label={label}>
    <div className={styles.canvas} aria-hidden="true">
      {slide && <MediaImage key={slide.src} src={slide.src} alt="" fill sizes={sizes} priority={priority}
        style={{ objectFit: 'cover', objectPosition: `var(--slideshow-position, ${slide.position || 'center'})` }}
        onError={() => setIndex(current => current + 1 < slides.length ? current + 1 : current)} />}
    </div>
  </div>
}
