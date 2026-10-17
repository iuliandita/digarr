;(() => {
  const mode = localStorage.getItem('digarr-theme') || 'system'
  const color = localStorage.getItem('digarr-color-theme') || 'youtarr'
  const resolved =
    mode === 'system'
      ? matchMedia('(prefers-color-scheme: light)').matches
        ? 'light'
        : 'dark'
      : mode
  document.documentElement.setAttribute('data-theme', `${color}-${resolved}`)
})()
