import Image from 'next/image'
import styles from './BrandLogo.module.css'

export default function BrandLogo({
  placement = 'header',
}: {
  placement?: 'header' | 'footer' | 'sidebar'
}) {
  return (
    <Image
      src="/brand/v1/vacaynanny-logo.svg"
      alt="VacayNanny"
      width={665}
      height={160}
      className={`${styles.logo} ${styles[placement]}`}
      loading={placement === 'footer' ? 'lazy' : 'eager'}
      unoptimized
    />
  )
}
