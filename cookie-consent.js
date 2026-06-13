(function () {
  const KEY = 'fr_cookie_consent'
  if (localStorage.getItem(KEY)) return  // already answered

  const banner = document.createElement('div')
  banner.id = 'cookie-banner'
  banner.style.cssText = [
    'position:fixed',
    'bottom:1.25rem',
    'left:50%',
    'transform:translateX(-50%) translateY(120%)',
    'z-index:9999',
    'width:calc(100% - 2.5rem)',
    'max-width:640px',
    'background:rgba(15,15,15,0.96)',
    'backdrop-filter:blur(20px)',
    '-webkit-backdrop-filter:blur(20px)',
    'border:1px solid rgba(255,255,255,0.1)',
    'border-radius:16px',
    'padding:1.125rem 1.25rem',
    'display:flex',
    'align-items:center',
    'justify-content:space-between',
    'gap:1rem',
    'flex-wrap:wrap',
    'box-shadow:0 16px 48px rgba(0,0,0,0.6)',
    'transition:transform 0.45s cubic-bezier(0.16,1,0.3,1)',
    'font-family:Inter,sans-serif',
  ].join(';')

  banner.innerHTML = `
    <p style="font-size:.8125rem;color:#a1a1aa;line-height:1.6;flex:1;min-width:200px;margin:0;">
      We use cookies to improve your experience and analyse site usage.
      By clicking <strong style="color:#e4e4e7;">Accept</strong> you agree to our
      <a href="privacy.html" style="color:#a78bfa;text-decoration:none;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">Privacy Policy</a>.
    </p>
    <div style="display:flex;gap:.5rem;flex-shrink:0;">
      <button id="cookie-decline" style="font-size:.8125rem;font-weight:500;color:#71717a;background:transparent;border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:.4rem .9rem;cursor:pointer;transition:color .15s,border-color .15s;white-space:nowrap;"
        onmouseover="this.style.color='#a1a1aa';this.style.borderColor='rgba(255,255,255,0.2)'"
        onmouseout="this.style.color='#71717a';this.style.borderColor='rgba(255,255,255,0.1)'">
        Decline
      </button>
      <button id="cookie-accept" style="font-size:.8125rem;font-weight:600;color:#fff;background:linear-gradient(135deg,#7c3aed,#6d28d9);border:none;border-radius:8px;padding:.4rem 1rem;cursor:pointer;transition:opacity .15s;white-space:nowrap;"
        onmouseover="this.style.opacity='.85'"
        onmouseout="this.style.opacity='1'">
        Accept
      </button>
    </div>`

  document.body.appendChild(banner)

  // Slide in after a short delay
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      banner.style.transform = 'translateX(-50%) translateY(0)'
    })
  })

  function dismiss(choice) {
    localStorage.setItem(KEY, choice)
    banner.style.transform = 'translateX(-50%) translateY(140%)'
    setTimeout(() => banner.remove(), 500)
  }

  document.getElementById('cookie-accept').addEventListener('click', () => dismiss('accepted'))
  document.getElementById('cookie-decline').addEventListener('click', () => dismiss('declined'))
})()
