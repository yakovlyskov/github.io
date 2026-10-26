import React from 'react';
import {createRoot} from 'react-dom/client';
import Game from './game';
import './game.css';
createRoot(document.getElementById('root')!).render(<Game/>);
