// Modified from AionUI by WINK GO contributors in 2026.
import WinkGoSelect from '@/renderer/components/base/WinkGoSelect';
import type { SelectHandle } from '@arco-design/web-react/es/Select/interface';
import React, { useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { LANGUAGE_OPTIONS } from '@/common/config/i18n';
import { changeLanguage } from '@/renderer/services/i18n';

const LanguageSwitcher: React.FC = () => {
  const { i18n } = useTranslation();
  const selectRef = useRef<SelectHandle>(null);

  const handleLanguageChange = useCallback((value: string) => {
    // 切换前先 blur 触发元素，避免弹层和语言切换竞争布局
    // Blur before switching to avoid dropdown and language change fighting for layout
    selectRef.current?.blur?.();

    const applyLanguage = () => {
      changeLanguage(value).catch((error: Error) => {
        console.error('Failed to change language:', error);
      });
    };

    if (typeof window !== 'undefined' && 'requestAnimationFrame' in window) {
      // 延迟到下一帧执行，确保 DOM 动画已完成 / defer to next frame so DOM animations finish
      window.requestAnimationFrame(() => window.requestAnimationFrame(applyLanguage));
    } else {
      setTimeout(applyLanguage, 0);
    }
  }, []);

  return (
    <div className='flex items-center gap-8px'>
      <WinkGoSelect ref={selectRef} className='w-160px' value={i18n.language} onChange={handleLanguageChange}>
        {LANGUAGE_OPTIONS.map(({ code, label }) => (
          <WinkGoSelect.Option key={code} value={code}>
            {label}
          </WinkGoSelect.Option>
        ))}
      </WinkGoSelect>
    </div>
  );
};

export default LanguageSwitcher;
