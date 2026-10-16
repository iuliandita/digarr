import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import '@fontsource-variable/roboto-flex/wdth.css'
import './index.css'
import { I18nProvider } from './lib/i18n'

const root = document.getElementById('root')
if (!root) throw new Error('root element not found')
ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </React.StrictMode>,
)
