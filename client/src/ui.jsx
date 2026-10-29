import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

const tones = ['#32362c', '#36342c', '#2e3638', '#38302e', '#2e3438', '#362e32']

function tone(title) {
  let hash = 0
  for (const char of title || '') hash = (hash + char.charCodeAt(0)) % tones.length
  return tones[hash]
}

export function Brand() {
  return (
    <span className="brand">
      <span className="brand-mark" aria-hidden="true" />
      Captarr
    </span>
  )
}

export function PageHead({ title, lede, actions }) {
  useEffect(() => {
    document.title = `${title} · Captarr`
  }, [title])
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        {lede ? <p className="lede">{lede}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  )
}

export function Banner({ children }) {
  if (!children) return null
  return <div className="banner" role="alert">{children}</div>
}

export function NotConnected({ name, hash }) {
  return (
    <div className="page narrow">
      <PageHead title={name} lede={`${name} isn't connected.`} />
      <Link className="button primary" to={`/settings#${hash}`}>Connect {name}</Link>
    </div>
  )
}

export function Poster({ item, service }) {
  const proxied = item?.posterPath
    ? `/api/images/${service}?path=${encodeURIComponent(item.posterPath)}`
    : ''
  const remote = item?.remotePoster || ''
  const initial = proxied || remote
  const [src, setSrc] = useState(initial)
  const [failed, setFailed] = useState(!initial)
  useEffect(() => {
    setSrc(initial)
    setFailed(!initial)
  }, [initial])
  if (!src || failed) {
    const letter = (item?.title || '?').trim().slice(0, 1).toUpperCase()
    return (
      <div className="poster-fallback" style={{ background: tone(item?.title) }} aria-hidden="true">
        {letter}
      </div>
    )
  }
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      onError={() => {
        if (remote && src !== remote) setSrc(remote)
        else setFailed(true)
      }}
    />
  )
}

export function Bone({ width, height, className = '' }) {
  const style = {}
  if (width != null) style.width = width
  if (height != null) style.height = height
  return <span className={className ? `bone ${className}` : 'bone'} style={style} aria-hidden="true" />
}

export function SkeletonRows({ columns, rows = 6 }) {
  return Array.from({ length: rows }, (_, row) => (
    <tr key={row} aria-hidden="true">
      {Array.from({ length: columns }, (_, column) => (
        <td key={column}><Bone width={column === 0 ? '68%' : '56px'} /></td>
      ))}
    </tr>
  ))
}

export function Modal({ title, onClose, children }) {
  const ref = useRef(null)
  useEffect(() => {
    ref.current?.focus()
    function onKey(event) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">×</button>
        </header>
        {children}
      </div>
    </div>
  )
}
