/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Button } from '@arco-design/web-react';
import { Browser } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { openDynamicIslandPanel } from '@/renderer/utils/winkgo/openDynamicIslandPanel';
import styles from './BrowserSkillToolbarAction.module.css';

const BrowserSkillToolbarAction: React.FC = () => {
  const { t } = useTranslation();
  const label = t('common.browserComputerUse.title', { defaultValue: 'WINK GO 浏览器 Computer Use' });
  return (
    <Button
      className={styles.trigger}
      size='small'
      type='secondary'
      icon={<Browser theme='outline' size='16' fill='currentColor' />}
      aria-label={label}
      title={t('common.browserComputerUse.hint', { defaultValue: '使用模型操作软件内置浏览器' })}
      data-testid='browser-computer-use-toolbar-button'
      onClick={() => void openDynamicIslandPanel('browserComputerUse')}
    >
      <span className={styles.label}>{label}</span>
    </Button>
  );
};

export default BrowserSkillToolbarAction;
