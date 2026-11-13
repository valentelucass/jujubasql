import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import '@xyflow/react/dist/style.css'
import './views/studio.css'
import { App } from './views/App'
import { DesktopUpdates } from './views/DesktopUpdates'

createRoot(document.getElementById('root')!).render(<StrictMode><DesktopUpdates><App /></DesktopUpdates></StrictMode>)
