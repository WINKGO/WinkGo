/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useLayoutEffect } from 'react';
import { HashRouter } from 'react-router';
import TitlebarDynamicIsland from './TitlebarDynamicIsland';
import './desktop-island-window.css';

const DesktopIslandWindow: React.FC = () => {
  useLayoutEffect(() => {
    document.documentElement.classList.add('desktop-island-runtime');
    void window.electronAPI?.desktopIsland?.ready();
    return () => document.documentElement.classList.remove('desktop-island-runtime');
  }, []);

  return (
    <main className='desktop-island-window' aria-label='WINK GO 桌面灵动岛'>
      <HashRouter>
        <TitlebarDynamicIsland floating />
      </HashRouter>
    </main>
  );
};

export default DesktopIslandWindow;
