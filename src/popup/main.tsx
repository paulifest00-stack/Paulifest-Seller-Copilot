import React from 'react';
import ReactDOM from 'react-dom/client';
import { PopupApp } from './App';
import '../styles/globals.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <PopupApp />
  </React.StrictMode>
);
