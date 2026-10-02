import '@fontsource-variable/inter'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import App from './App'
import { BoardsProvider } from './board/store'
import './i18n'
import './styles/index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <BoardsProvider>
        <App />
      </BoardsProvider>
    </BrowserRouter>
  </StrictMode>,
)
