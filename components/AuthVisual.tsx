import MediaImage from './MediaImage'

export default function AuthVisual({ children }: { children: React.ReactNode }) {
  return (
    <aside className="login-visual" aria-label="A little holiday inspiration">
      <div className="login-image-frame">
        {/* The tall desktop pane crops this landscape source to its height. */}
        <MediaImage
          className="login-image"
          src="/images/destinations/diani.webp"
          alt="AI-generated scene of palms beside a quiet Kenyan beach"
          fill
          sizes="(max-width: 900px) 100vw, 150vh"
          priority
        />
      </div>
      <div className="login-image-shade" />
      {children}
      <span className="login-image-credit">AI-generated coastal scene</span>
    </aside>
  )
}
