import { describe, expect, it } from 'vitest';
import {
  extractMailVerificationCode,
  isLikelyVerificationMail,
} from '@renderer/components/layout/Titlebar/mailVerificationCode';

describe('mailVerificationCode', () => {
  it('extracts common Chinese and English verification codes', () => {
    expect(extractMailVerificationCode('您的临时 ChatGPT 登录代码', '验证码：912 102，请勿转发。')).toBe('912102');
    expect(extractMailVerificationCode('Your sign-in code', 'Your verification code is 483921.')).toBe('483921');
    expect(extractMailVerificationCode('安全代码 ８２６４１５', '')).toBe('826415');
  });

  it('finds a standalone code when the verification keyword is only in the subject', () => {
    expect(extractMailVerificationCode('登录验证码', '731905\nThis code expires in ten minutes.')).toBe('731905');
  });

  it('does not expose dates or ordinary order numbers as verification codes', () => {
    expect(extractMailVerificationCode('8 月账单', '订单号 202608051234，合计 88 元。')).toBeNull();
    expect(extractMailVerificationCode('安全提醒', '登录时间：2026-08-05 12:30')).toBeNull();
  });

  it('limits background previews to messages that look like verification mail', () => {
    expect(isLikelyVerificationMail({ subject: '您的临时 ChatGPT 登录代码' })).toBe(true);
    expect(isLikelyVerificationMail({ subject: '周报与项目附件' })).toBe(false);
  });
});
