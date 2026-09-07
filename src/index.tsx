import 'bootstrap/scss/bootstrap.scss';
import './styles.scss';
import React from 'react';
import {createRoot} from 'react-dom/client';
import {App} from './App';

createRoot(document.getElementById('app_main')!).render(<App />);