import styles from './Portal.module.css'

export default function PortalNavigation({ label, items }: { label: string; items: Array<{ id: string; label: string }> }) {
  return <nav className={styles.navigation} aria-label={label}>{items.map(item => <a href={`#${item.id}`} key={item.id}>{item.label}</a>)}</nav>
}
