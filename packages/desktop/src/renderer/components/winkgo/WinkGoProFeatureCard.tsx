/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Button } from '@arco-design/web-react';
import { Lock } from '@icon-park/react';
import type { WinkGoCapability } from '@/common/types/platform/winkGoEdition';
import { useAuth } from '@/renderer/hooks/context/AuthContext';
import { openExternalUrl } from '@/renderer/utils/platform';

interface WinkGoProFeatureCardProps {
  capability: WinkGoCapability;
  title: string;
  description: string;
  children: React.ReactNode;
}

/**
 * Keeps paid modules discoverable without loading or invoking their runtime
 * until the signed desktop session grants the required capability.
 */
const WinkGoProFeatureCard: React.FC<WinkGoProFeatureCardProps> = ({ capability, title, description, children }) => {
  const { can, edition } = useAuth();

  if (can(capability)) return <>{children}</>;

  return (
    <section
      className='mx-auto mt-28px max-w-720px rd-22px border border-border-2 bg-1 px-32px py-38px text-center shadow-sm'
      data-testid={`winkgo-pro-gate-${capability}`}
    >
      <div className='mx-auto mb-18px size-52px flex items-center justify-center rd-16px bg-primary-1 text-primary-6'>
        <Lock theme='outline' size='25' />
      </div>
      <div className='mb-6px text-20px font-700 text-t-primary'>{title}</div>
      <p className='mx-auto mb-20px max-w-520px text-14px leading-24px text-t-secondary'>{description}</p>
      <div className='mb-20px flex items-center justify-center gap-8px text-12px text-t-tertiary'>
        <span className='rd-full bg-fill-2 px-10px py-4px'>
          当前：{edition.accountEdition === 'pro' ? 'WINK GO Pro' : 'WINK GO 免费版'}
        </span>
        {edition.buildEdition === 'free' && <span className='rd-full bg-fill-2 px-10px py-4px'>需安装 Pro 客户端</span>}
      </div>
      <Button type='primary' onClick={() => void openExternalUrl('https://winkgo.top/')}>
        查看 WINK GO Pro
      </Button>
    </section>
  );
};

export default WinkGoProFeatureCard;
